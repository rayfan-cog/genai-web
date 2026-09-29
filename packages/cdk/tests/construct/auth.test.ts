import { DEFAULT_PASSWORD_POLICY } from '@genai-web/common';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Key } from 'aws-cdk-lib/aws-kms';
import { describe, test } from 'vitest';
import { Auth } from '../../lib/construct/auth';

describe('Auth Construct', () => {
  test('email changes require verification', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'AuthTestStack');
    const key = new Key(stack, 'Key');

    new Auth(stack, 'Auth', {
      encryptionKey: key,
      selfSignUpEnabled: true,
      allowedIpV4AddressRanges: null,
      allowedIpV6AddressRanges: null,
      allowedSignUpEmailDomains: null,
      samlAuthEnabled: false,
      customEmailSender: null,
      emailMfaRequired: false,
      passwordPolicy: DEFAULT_PASSWORD_POLICY,
      reauthenticationIntervalDays: 30,
      appEnv: '',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPool', {
      UserAttributeUpdateSettings: {
        AttributesRequireVerificationBeforeUpdate: ['email'],
      },
    });
  });
});
