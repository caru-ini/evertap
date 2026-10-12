import { STORAGE_URL_EXAMPLE } from "@evertap/api/rules";
import type { ObjectStorage } from "@evertap/api/schemas";
import { buttonVariants } from "@evertap/ui/components/button";
import { Switch } from "@evertap/ui/components/switch";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ConnectionUrl } from "@/components/connection-url.tsx";
import { FormatSwitch } from "@/components/format-switch.tsx";
import { ProxyConfig } from "@/components/proxy-config.tsx";
import { orpc } from "@/lib/orpc.ts";

import styles from "./reachable-anywhere.module.css";

const LANGUAGES = [
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
] as const;

type Language = (typeof LANGUAGES)[number]["id"];

/** A second client that only signs links, from the `.env` values; the app's own client stays. */
const SIGNERS: Record<Language, string> = {
  javascript: `import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Only for signing links; every other call keeps to AWS_ENDPOINT_URL_S3
const signer = new S3Client({
  endpoint: process.env.S3_PUBLIC_ENDPOINT,
  forcePathStyle: true,
});

const url = await getSignedUrl(
  signer,
  new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: "avatar.png" }),
  { expiresIn: 3600 },
);
`,
  python: `import os

import boto3
from botocore.config import Config

# Only for signing links; every other call keeps to AWS_ENDPOINT_URL_S3
signer = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_PUBLIC_ENDPOINT"],
    # boto3 reads AWS_DEFAULT_REGION, not AWS_REGION
    region_name=os.environ["AWS_REGION"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

url = signer.generate_presigned_url(
    "put_object",
    Params={"Bucket": os.environ["S3_BUCKET"], "Key": "avatar.png"},
    ExpiresIn=3600,
)
`,
};

const Signer = () => {
  const [language, setLanguage] = useState<Language>("javascript");
  const label = LANGUAGES.find((item) => item.id === language)?.label ?? "";

  return (
    <>
      <p className={styles.note}>
        Sign links with a second client on <code className={styles.mono}>S3_PUBLIC_ENDPOINT</code>,
        from the .env values above, and keep your client on the endpoint for everything else.
      </p>
      <FormatSwitch legend="Language" options={LANGUAGES} value={language} onChange={setLanguage} />
      <ConnectionUrl value={SIGNERS[language]} size="lg" copyLabel={`Copy the ${label} example`} />
    </>
  );
};

/**
 * The switch for signed links that work on any device, shown only where other machines reach
 * evertap. Until buckets have an address of their own it says how to give them one.
 */
export const ReachableAnywhere = ({ resource }: { resource: ObjectStorage }) => {
  const queryClient = useQueryClient();
  const settings = useQuery(orpc.system.settings.get.queryOptions());
  const guide = useQuery(orpc.system.settings.network.queryOptions());
  const setReachable = useMutation(
    orpc.resources.setReachableAnywhere.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.resources.key() });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const mode = settings.data?.mode.value;
  if (mode !== "network" && mode !== "cloudflare") {
    return null;
  }
  const addressed = (settings.data?.storageUrl.value ?? null) !== null;
  const buckets = guide.data?.buckets;
  const on = resource.reachableAnywhere;

  return (
    <section className={styles.section}>
      <label className={styles.toggle}>
        <Switch
          checked={on}
          // Switching off is always allowed; switching on waits for an address.
          disabled={setReachable.isPending || (!on && !addressed)}
          onCheckedChange={(checked) => {
            setReachable.mutate({ id: resource.id, reachableAnywhere: checked });
          }}
          className={styles.switch}
        />
        <span className={styles.text}>
          <span className={styles.title}>Reachable from anywhere</span>
          <span className={styles.note}>
            Signed links work on any device, such as a preview deployment, a phone, or an outside
            service. Objects still need a signature.
          </span>
        </span>
      </label>
      {!addressed ? (
        <div className={styles.setup}>
          {mode === "network" ? (
            <>
              <p className={styles.note}>
                Give buckets an address of their own on your proxy first. Paste this into it,
                changing <code className={styles.mono}>{new URL(STORAGE_URL_EXAMPLE).host}</code> to
                that address, then add the address in Settings.
              </p>
              {buckets?.proxy ? <ProxyConfig configs={buckets.proxy} /> : null}
            </>
          ) : (
            // The tunnel evertap runs serves buckets at a name of their own once it exists.
            <p className={styles.note}>
              Set up the Cloudflare Tunnel in Settings first. evertap then serves buckets at a name
              of their own.
            </p>
          )}
          <div>
            <Link to="/settings" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Open Settings
              <ArrowRightIcon aria-hidden />
            </Link>
          </div>
        </div>
      ) : on ? (
        <Signer />
      ) : null}
    </section>
  );
};
