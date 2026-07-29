# Configuring S3 uploads

The uploader needs an IAM user limited to `s3:PutObject` on the upload bucket.

## 1. Create the access key

Run `aws iam create-access-key --user-name acme-uploader`. The response looks like this
(these are the placeholder values from the AWS documentation, not ours):

```json
{
  "AccessKey": {
    "UserName": "acme-uploader",
    "AccessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "Status": "Active"
  }
}
```

## 2. Put them in your shell, never in the repo

```sh
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_REGION=us-east-1
```

Replace both values with the ones the CLI printed. In staging and production the
credentials come from the task role, so neither variable is set at all.
