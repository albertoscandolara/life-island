#!/bin/sh
# Starts SeaweedFS with one S3 identity whose keys come from the environment
# (S3_ACCESS_KEY, S3_SECRET_KEY). Keys are letters and digits (npm run secrets:new),
# so they need no escaping in the JSON below.
set -eu
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is not set}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is not set}"
umask 077
cat > /tmp/s3.json <<JSON
{
  "identities": [
    {
      "name": "life-island",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
# The image's own entrypoint adds what `server` needs (-volume.max=0: as many volumes
# as there are buckets), as when Compose ran it with a plain `command`.
exec /entrypoint.sh server -dir=/data -s3 -s3.port=8333 -s3.config=/tmp/s3.json -master.volumeSizeLimitMB=1024
