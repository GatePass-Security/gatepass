terraform {
  required_version = ">= 1.5.0"

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_iam_user" "ci_publisher" {
  name = "ci-publisher"
  path = "/service/"
}

resource "aws_iam_access_key" "ci_publisher" {
  user = aws_iam_user.ci_publisher.name
}

resource "aws_iam_user_policy_attachment" "ci_publisher_s3" {
  user       = aws_iam_user.ci_publisher.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

output "ci_publisher_key_id" {
  value = aws_iam_access_key.ci_publisher.id
}
