import { type Address, listenAt } from "./listener.ts";

/** S3 caps a single PUT at 5 GiB; anything larger is a multipart upload of smaller parts. */
const BODY_MAX = 5 * 1024 * 1024 * 1024;

export const s3Error = (status: number, code: string, message: string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
    { status, headers: { "content-type": "application/xml" } },
  );

/** The access key a credential (`<key>/<date>/<region>/s3/aws4_request`) names. */
const credentialKey = (credential: string | undefined) => {
  const slash = credential?.indexOf("/") ?? -1;
  return credential !== undefined && slash > 0 ? credential.slice(0, slash) : null;
};

/** Lowercases ASCII letters alone, as Garage does with names; other letters stay as they are. */
const asciiLower = (text: string) => text.replaceAll(/[A-Z]+/g, (upper) => upper.toLowerCase());

/** The Credential of an Authorization header, split into fields as Garage splits them. */
const headerCredential = (authorization: string) => {
  // Garage keeps the last of several, so one header could name two keys.
  if (authorization.split("Credential=").length !== 2) {
    return undefined;
  }
  const space = authorization.indexOf(" ");
  if (space < 0 || authorization.slice(0, space) !== "AWS4-HMAC-SHA256") {
    return undefined;
  }
  let credential: string | undefined;
  for (const field of authorization.slice(space + 1).split(",")) {
    const trimmed = field.trim();
    const equals = trimmed.indexOf("=");
    if (equals < 0) {
      return undefined;
    }
    if (trimmed.slice(0, equals) === "Credential") {
      credential = trimmed.slice(equals + 1).replace(/^=+/, "");
    }
  }
  return credential;
};

/**
 * The access key Garage takes a request as signed with, read as Garage reads it: the query's when
 * it has an X-Amz-Algorithm in any case, and otherwise the Authorization header's. Null for a
 * request Garage takes as anonymous or refuses, and for a header that names more than one key.
 * Reading it any other way would let a request name one key here and another to Garage.
 */
export const signingKey = (request: Request, url: URL): string | null => {
  const query = new Map<string, string>();
  for (const [name, value] of url.searchParams) {
    const lower = asciiLower(name);
    // Garage refuses a name given twice, in any case.
    if (query.has(lower)) {
      return null;
    }
    query.set(lower, value);
  }
  if (query.has("x-amz-algorithm")) {
    return credentialKey(query.get("x-amz-credential"));
  }
  const authorization = request.headers.get("authorization");
  return authorization === null ? null : credentialKey(headerCredential(authorization));
};

/**
 * What an ACL request is answered with: Garage has no ACLs and answers 501, which stops libraries
 * that send them on every copy or write (Laravel's `Storage::copy`, `visibility`). The key's own
 * buckets are private to it, so it holds full control and a change has nothing to do.
 */
const aclAnswer = (method: string, owner: string) => {
  if (method === "PUT") {
    return new Response(null, { status: 200 });
  }
  if (method !== "GET") {
    return null;
  }
  const user = `<ID>${owner}</ID><DisplayName>${owner}</DisplayName>`;
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner>${user}</Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser">${user}</Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>`,
    { headers: { "content-type": "application/xml" } },
  );
};

/** The bucket a CreateBucket names: a PUT on a bucket's path with no subresource in its query. */
const createdBucket = (method: string, url: URL) => {
  if (method !== "PUT") {
    return null;
  }
  const bucket = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const subresource = [...url.searchParams.keys()].some(
    (name) => name !== "x-id" && !name.toLowerCase().startsWith("x-amz-"),
  );
  return bucket === undefined || subresource ? null : decodeURIComponent(bucket);
};

export type S3Proxy = {
  /** Listens at `address` instead; see `listenAt`. */
  move: (address: Address) => void;
  stop: () => void;
  /** Whether a request signed with the resource's key succeeded since the last call. */
  takeConnected: (id: string) => boolean;
  /** Passes a request that came in some other way on as the entry does, counting its use. */
  forward: (request: Request) => Promise<Response>;
};

/**
 * The engine's entry on the LAN: passes every request to the shared instance as it came, Host
 * header included, so signatures still match. It notes which resource's key was used, since the
 * engine records no last use per key, answers ACL requests itself, and tells the driver about
 * each bucket a key creates.
 */
export const startS3Proxy = (options: {
  hostname: string;
  port: number;
  /** The instance's port on 127.0.0.1; throws while it is not running. */
  upstream: () => Promise<number>;
  /** The port stopped answering; the next `upstream` should look it up again. */
  unreachable: () => void;
  /** Resource id for an access key, or null for one evertap did not hand out. */
  resolve: (accessKeyId: string) => string | null;
  /** A key evertap handed out created a bucket; awaited before the answer goes back. */
  created: (accessKeyId: string, bucket: string) => Promise<void>;
}): S3Proxy => {
  const used = new Set<string>();

  const fetchUpstream = async (request: Request) => {
    const url = new URL(request.url);
    const key = signingKey(request, url);
    const id = key === null ? null : options.resolve(key);
    if (key !== null && id !== null && url.searchParams.has("acl")) {
      const answer = aclAnswer(request.method, key);
      if (answer !== null) {
        return answer;
      }
    }
    const headers = new Headers(request.headers);
    const signed =
      /SignedHeaders=([^,\s]+)/.exec(request.headers.get("authorization") ?? "")?.[1] ??
      url.searchParams.get("X-Amz-SignedHeaders") ??
      "";
    // The client has been told to go on already; passed on, it delays each body by about 40 ms.
    if (!signed.split(";").includes("expect")) {
      headers.delete("expect");
    }
    let response: Response;
    try {
      const port = await options.upstream();
      response = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        // Objects stored gzip-encoded must reach the client byte for byte.
        decompress: false,
      });
    } catch {
      options.unreachable();
      return s3Error(
        503,
        "ServiceUnavailable",
        "This bucket is not answering. Try again in a moment",
      );
    }
    if (key !== null && id !== null && response.status < 400) {
      used.add(id);
      const bucket = createdBucket(request.method, url);
      if (bucket !== null) {
        // The bucket is in use as soon as the app has its answer, from a browser too.
        await options.created(key, bucket).catch((error: unknown) => {
          console.error(`setting up ${bucket}:`, error);
        });
      }
    }
    return response;
  };
  const listener = listenAt({ hostname: options.hostname, port: options.port }, (address) =>
    Bun.serve({
      ...address,
      maxRequestBodySize: BODY_MAX,
      // A large copy or delete can take a while before the first byte of the answer.
      idleTimeout: 120,
      // Otherwise a thrown error is answered with the stack and the source lines.
      development: false,
      fetch: fetchUpstream,
    }),
  );

  return {
    move: listener.move,
    stop: listener.stop,
    takeConnected: (id) => used.delete(id),
    forward: fetchUpstream,
  };
};

/** How much of a form is read for its key; the fields come first, and S3 caps a policy at 20 KB. */
const FORM_FIELDS_MAX = 64 * 1024;

/**
 * A form's boundary, from a Content-Type as browsers and SDKs write it; null for any other, as
 * Garage reads quoting and other characters its own way.
 */
const formBoundary = (contentType: string | null) => {
  const match =
    /^multipart\/form-data; boundary=(?:"([0-9A-Za-z'+_.-]{1,70})"|([0-9A-Za-z'+_.-]{1,70}))$/.exec(
      contentType ?? "",
    );
  return match?.[1] ?? match?.[2] ?? null;
};

/**
 * A part's field name, lowercased; null when its headers are not plainly a form field's. Only the
 * file's part may carry more than its name: a field's Content-Type could have Garage read its value
 * in another charset.
 */
const partName = (headers: string) => {
  let name: string | null = null;
  let others = false;
  for (const line of headers.split("\r\n")) {
    const header = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!header) {
      return null;
    }
    if (asciiLower(header[1] ?? "") !== "content-disposition") {
      others = true;
      continue;
    }
    const field = /^form-data; name="([^"\\]*)"(?:; filename="[^"\\]*")?$/.exec(header[2] ?? "");
    if (name !== null || !field) {
      return null;
    }
    name = asciiLower(field[1] ?? "");
  }
  return others && name !== "file" ? null : name;
};

/**
 * The fields before the file, by lowercased name, as Garage reads a form: it stops at the part
 * named `file` and refuses a field given twice. Undefined until the file's part has arrived; null
 * for a form that is not plainly built, which Garage could split otherwise.
 */
const formFields = (text: string, boundary: string) => {
  const delimiter = `--${boundary}`;
  if (text.length < delimiter.length + 2) {
    return undefined;
  }
  if (!text.startsWith(`${delimiter}\r\n`)) {
    return null;
  }
  const fields = new Map<string, string>();
  let at = delimiter.length + 2;
  for (;;) {
    const headersEnd = text.indexOf("\r\n\r\n", at);
    if (headersEnd < 0) {
      return undefined;
    }
    const headers = text.slice(at, headersEnd);
    const name = headers.includes(delimiter) ? null : partName(headers);
    if (name === null) {
      return null;
    }
    if (name === "file") {
      return fields;
    }
    const end = text.indexOf(`\r\n${delimiter}`, headersEnd + 4);
    const next = text.slice(end + 2 + delimiter.length, end + 4 + delimiter.length);
    if (end < 0 || next.length < 2) {
      return undefined;
    }
    const value = text.slice(headersEnd + 4, end);
    // `--` ends the form before its file; the delimiter in any other place is not plain.
    if (next !== "\r\n" || value.includes(delimiter) || fields.has(name)) {
      return null;
    }
    fields.set(name, value);
    at = end + 4 + delimiter.length;
  }
};

/**
 * The key a form upload (a presigned POST) signs with, from the fields before its file, which S3
 * takes last. Only those are read; the request goes on with its whole body.
 */
const formKey = async (request: Request) => {
  const boundary = formBoundary(request.headers.get("content-type"));
  if (request.body === null || boundary === null) {
    return { key: null, request };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("latin1");
  const head: Uint8Array[] = [];
  let text = "";
  let fields: Map<string, string> | null | undefined;
  let ended = false;
  while (fields === undefined && !ended && text.length < FORM_FIELDS_MAX) {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
    } else {
      head.push(value);
      text += decoder.decode(value, { stream: true });
      // The file has to begin within the bytes read, however many arrive at once.
      fields = formFields(text.slice(0, FORM_FIELDS_MAX), boundary);
    }
  }
  const key = credentialKey(fields?.get("x-amz-credential"));
  // What was read goes first, then the rest as it arrives.
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of head) {
        controller.enqueue(chunk);
      }
      if (ended) {
        controller.close();
      }
    },
    pull: async (controller) => {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const { method, headers, url } = request;
  return { key, request: new Request(url, { method, headers, body }) };
};

/**
 * The entry a proxy or tunnel exposes for buckets reached from anywhere. A request is routed by
 * the key that signs it, as each key names its buckets in a namespace of its own. Listening apart
 * from the relay's entries tells where a request came from by the way in, not by a Host anyone can
 * send. Every answer tells a CDN not to keep it: an object can carry `Cache-Control: public`, and
 * a cache key leaves out the signature.
 */
export const startPublicS3 = (options: {
  /** Whether the key belongs to a bucket resource switched on. */
  reachable: (accessKeyId: string) => boolean;
  forward: (request: Request) => Promise<Response>;
}) => {
  const answer = async (incoming: Request) => {
    // A browser's preflight carries no key; the engine answers it from the bucket's CORS rules.
    if (incoming.method === "OPTIONS") {
      return options.forward(incoming);
    }
    const url = new URL(incoming.url);
    // Garage takes a POST to a bucket as a form upload, signed by its fields alone, unless it
    // deletes objects; the header and the query are not read then.
    const { key, request } =
      incoming.method === "POST" &&
      /^\/+[^/]+\/*$/.test(url.pathname) &&
      !url.searchParams.has("delete")
        ? await formKey(incoming)
        : { key: signingKey(incoming, url), request: incoming };
    if (key === null || !options.reachable(key)) {
      return s3Error(
        403,
        "AccessDenied",
        "evertap does not answer for this bucket here. Turn on Reachable from anywhere for it, and sign with its own key",
      );
    }
    return options.forward(request);
  };
  const fetch = async (request: Request) => {
    const response = await answer(request);
    response.headers.set("cloudflare-cdn-cache-control", "no-store");
    return response;
  };
  const bind = (address: Address) =>
    Bun.serve({
      ...address,
      maxRequestBodySize: BODY_MAX,
      idleTimeout: 120,
      development: false,
      fetch,
    });
  let listener: ReturnType<typeof listenAt> | null = null;

  return {
    /**
     * Listens at `address`, or stops for null. Throws when it cannot listen there, leaving it
     * unbound until the next call.
     */
    move: (address: Address | null) => {
      if (address === null) {
        listener?.stop();
        listener = null;
      } else if (listener === null) {
        listener = listenAt(address, bind);
      } else {
        listener.move(address);
      }
    },
    stop: () => {
      listener?.stop();
      listener = null;
    },
  };
};
