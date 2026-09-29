import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const originalEnv = process.env;

const loadCognitoApi = async () => {
  return import('../../../lambda/utils/cognitoApi');
};

const createUser = (
  sub: string,
  email: string,
  emailVerified: string,
  userStatus: UserType['UserStatus'] = 'CONFIRMED',
): UserType => ({
  Username: sub,
  UserStatus: userStatus,
  Attributes: [
    { Name: 'sub', Value: sub },
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: emailVerified },
  ],
});

describe('findUserByEmail', () => {
  beforeEach(() => {
    cognitoMock.reset();
    process.env = { ...originalEnv, USER_POOL_ID: 'ap-northeast-1_test' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('verified userを返す', async () => {
    cognitoMock.on(ListUsersCommand).resolves({
      Users: [createUser('sub-123', 'user@example.go.jp', 'true')],
    });
    const { findUserByEmail } = await loadCognitoApi();

    await expect(findUserByEmail('user@example.go.jp')).resolves.toEqual({
      userId: 'sub-123',
      email: 'user@example.go.jp',
    });
  });

  test('未検証でCONFIRMEDのuserは返さない', async () => {
    cognitoMock.on(ListUsersCommand).resolves({
      Users: [createUser('sub-123', 'user@example.go.jp', 'false')],
    });
    const { findUserByEmail } = await loadCognitoApi();

    await expect(findUserByEmail('user@example.go.jp')).resolves.toBeUndefined();
  });

  test('email未検証でもEXTERNAL_PROVIDER userを返す', async () => {
    cognitoMock.on(ListUsersCommand).resolves({
      Users: [createUser('sub-123', 'USER@example.go.jp', 'false', 'EXTERNAL_PROVIDER')],
    });
    const { findUserByEmail } = await loadCognitoApi();

    await expect(findUserByEmail('user@example.go.jp')).resolves.toEqual({
      userId: 'sub-123',
      email: 'USER@example.go.jp',
    });
  });

  test('userがいない場合はundefinedを返す', async () => {
    cognitoMock.on(ListUsersCommand).resolves({ Users: [] });
    const { findUserByEmail } = await loadCognitoApi();

    await expect(findUserByEmail('user@example.go.jp')).resolves.toBeUndefined();
  });

  test('ListUsersが2件返した場合はundefinedを返す', async () => {
    cognitoMock.on(ListUsersCommand).resolves({
      Users: [
        createUser('sub-123', 'user@example.go.jp', 'true'),
        createUser('sub-456', 'user@example.go.jp', 'false'),
      ],
    });
    const { findUserByEmail } = await loadCognitoApi();

    await expect(findUserByEmail('user@example.go.jp')).resolves.toBeUndefined();
  });

  test('Filter値をescapeし、Limitと属性を指定する', async () => {
    cognitoMock.on(ListUsersCommand).resolves({ Users: [] });
    const { findUserByEmail } = await loadCognitoApi();

    await findUserByEmail('a"b@example.com');

    expect(cognitoMock.commandCalls(ListUsersCommand)[0].args[0].input).toMatchObject({
      Filter: 'email="a\\"b@example.com"',
      Limit: 2,
      AttributesToGet: ['email', 'email_verified', 'sub'],
      UserPoolId: 'ap-northeast-1_test',
    });
  });
});
