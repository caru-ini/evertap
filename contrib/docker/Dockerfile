# evertap from a release, for running it in Docker (docs/docker.mdx). Build it in a directory
# holding the unpacked Linux archives, evertap-linux-x64/ and evertap-linux-arm64/:
#
#   docker buildx build --platform linux/amd64,linux/arm64 -f contrib/docker/Dockerfile <dir>

FROM scratch AS release-amd64
COPY evertap-linux-x64/ /

FROM scratch AS release-arm64
COPY evertap-linux-arm64/ /

FROM release-${TARGETARCH} AS release

# glibc is all the binary needs: Bun carries its own TLS and root certificates.
FROM gcr.io/distroless/base-nossl-debian13:latest@sha256:af5cb8dd589b8520b8c06bebb9efb73d7e16406cab58e85c51761fff49d370a0
COPY --from=release /evertap /usr/local/bin/evertap
COPY --from=release /LICENSE /THIRD_PARTY_NOTICES.md /usr/share/doc/evertap/
LABEL org.opencontainers.image.source=https://github.com/caru-ini/evertap
# Docker on the host mounts files from here into the databases, so mount it at this same path.
ENV EVERTAP_DATA_DIR=/var/lib/evertap
# So that when a newer release is out, evertap says to pull it rather than run the install script.
ENV EVERTAP_IMAGE=1
ENTRYPOINT ["/usr/local/bin/evertap"]
CMD ["serve"]
