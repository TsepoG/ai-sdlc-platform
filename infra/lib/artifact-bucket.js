// @ts-check
import { RemovalPolicy } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';

/**
 * Create the artifact content bucket: private, encrypted, versioned, TLS-only. Prod retains it;
 * dev deletes it with its objects when the stack is destroyed.
 * @param {import('constructs').Construct} scope Parent construct.
 * @param {{ protectData: boolean }} props Whether prod-only protections apply.
 * @returns {Bucket} The bucket.
 */
export function createArtifactBucket(scope, { protectData }) {
  return new Bucket(scope, 'ArtifactBucket', {
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    encryption: BucketEncryption.S3_MANAGED,
    versioned: true,
    enforceSSL: true,
    removalPolicy: protectData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    autoDeleteObjects: !protectData,
  });
}
