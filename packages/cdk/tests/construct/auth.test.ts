import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { Auth } from '../../lib/construct/auth';

const createAuthTemplate = (
  allowedIpV4AddressRanges: string[] | null,
  allowedIpV6AddressRanges: string[] | null,
) => {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new cdk.Stack(app, 'TestStack');
  const key = new kms.Key(stack, 'Key');

  new Auth(stack, 'Auth', {
    encryptionKey: key,
    selfSignUpEnabled: false,
    allowedIpV4AddressRanges,
    allowedIpV6AddressRanges,
    allowedSignUpEmailDomains: null,
    samlAuthEnabled: false,
    customEmailSender: null,
    emailMfaRequired: false,
    passwordPolicy: {
      minLength: 8,
      requireLowercase: true,
      requireUppercase: true,
      requireDigits: true,
      requireSymbols: true,
    },
    reauthenticationIntervalDays: 1,
    appEnv: '',
  });

  return Template.fromStack(stack);
};

const getStatements = (policy: any) => {
  const statements = policy.Properties.PolicyDocument.Statement;
  return Array.isArray(statements) ? statements : [statements];
};

describe('Auth Construct', () => {
  test('applies the source IP deny policy to every identity pool role', () => {
    const template = createAuthTemplate(['192.0.2.0/24'], ['2001:db8::/32']);
    const resources = template.toJSON().Resources as Record<string, any>;
    const [roleAttachment] = Object.values(
      template.findResources('AWS::Cognito::IdentityPoolRoleAttachment'),
    ) as Array<{
      Properties: {
        Roles: { authenticated: { 'Fn::GetAtt': [string, string] } };
        RoleMappings: Record<
          string,
          {
            RulesConfiguration: {
              Rules: Array<{ RoleARN: { 'Fn::GetAtt': [string, string] } }>;
            };
          }
        >;
      };
    }>;
    const roleLogicalIds = new Set([
      roleAttachment.Properties.Roles.authenticated['Fn::GetAtt'][0],
      ...Object.values(roleAttachment.Properties.RoleMappings).flatMap((mapping) =>
        mapping.RulesConfiguration.Rules.map((rule) => rule.RoleARN['Fn::GetAtt'][0]),
      ),
    ]);

    expect(roleLogicalIds.size).toBe(4);

    const policies = Object.values(resources).filter(
      (resource) => resource.Type === 'AWS::IAM::Policy',
    );
    for (const logicalId of roleLogicalIds) {
      const statements = policies
        .filter((policy) =>
          policy.Properties.Roles.some((role: { Ref?: string }) => role.Ref === logicalId),
        )
        .flatMap(getStatements);

      expect(statements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Effect: 'Deny',
            Action: '*',
            Resource: '*',
            Condition: {
              NotIpAddress: {
                'aws:SourceIp': ['192.0.2.0/24', '2001:db8::/32'],
              },
            },
          }),
        ]),
      );
    }
  });

  test('does not add a source IP deny policy when no ranges are configured', () => {
    const template = createAuthTemplate(null, null);
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(getStatements);

    expect(
      statements.some((statement: any) => statement.Condition?.NotIpAddress !== undefined),
    ).toBe(false);
  });
});
