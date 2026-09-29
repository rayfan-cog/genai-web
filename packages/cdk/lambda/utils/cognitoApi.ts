import {
  AdminAddUserToGroupCommand,
  AdminAddUserToGroupCommandInput,
  AdminDeleteUserCommand,
  AdminDeleteUserCommandInput,
  AdminListGroupsForUserCommand,
  AdminListGroupsForUserCommandInput,
  AdminRemoveUserFromGroupCommand,
  AdminRemoveUserFromGroupCommandInput,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import { GroupName } from 'genai-web';

const client = new CognitoIdentityProviderClient();
const userPoolId = process.env.USER_POOL_ID;

export const addUserToGroup = async (
  userId: string,
  group: GroupName,
  overrideUserPoolId?: string,
): Promise<void> => {
  const input: AdminAddUserToGroupCommandInput = {
    UserPoolId: overrideUserPoolId ? overrideUserPoolId : userPoolId,
    Username: userId,
    GroupName: group,
  };

  await client.send(new AdminAddUserToGroupCommand(input));
};

export const findUserByEmail = async (
  email: string,
): Promise<{ userId: string; email: string } | undefined> => {
  const input: ListUsersCommandInput = {
    AttributesToGet: ['email', 'email_verified', 'sub'],
    Filter: `email="${email.replace(/[\\"]/g, '\\$&')}"`,
    Limit: 2,
    UserPoolId: userPoolId,
  };

  const response = await client.send(new ListUsersCommand(input));
  const users = response.Users ?? [];
  if (users.length > 1) {
    return undefined;
  }

  const trustedUsers = users.filter((user) => {
    const userEmail = user.Attributes?.find((attribute) => attribute.Name === 'email')?.Value;
    const emailVerified =
      user.Attributes?.find((attribute) => attribute.Name === 'email_verified')?.Value === 'true';
    const trustedSource = emailVerified || user.UserStatus === 'EXTERNAL_PROVIDER';
    return trustedSource && userEmail?.toLowerCase() === email.toLowerCase();
  });
  if (trustedUsers.length !== 1) {
    return undefined;
  }

  const user = trustedUsers[0];
  const userId = user.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  const userEmail = user.Attributes?.find((attribute) => attribute.Name === 'email')?.Value;
  if (!userId || !userEmail) {
    return undefined;
  }

  return { userId, email: userEmail };
};

export const findUserById = async (
  userId: string,
): Promise<{ userId: string; email: string } | undefined> => {
  const input: ListUsersCommandInput = {
    AttributesToGet: ['email', 'sub'],
    Filter: `sub="${userId}"`,
    Limit: 1,
    UserPoolId: userPoolId,
  };

  const response = await client.send(new ListUsersCommand(input));

  return response.Users!.length > 0
    ? {
        userId: response.Users![0].Attributes!.filter((attribute) => attribute.Name === 'sub')[0]
          .Value!,
        email: response.Users![0].Attributes!.filter((attribute) => attribute.Name === 'email')[0]
          .Value!,
      }
    : undefined;
};

export const listGroupsByUserId = async (userId: string) => {
  // Groupは現状3つなので、Limitなど実装しない
  const input: AdminListGroupsForUserCommandInput = {
    UserPoolId: userPoolId,
    Username: userId,
  };

  const response = await client.send(new AdminListGroupsForUserCommand(input));

  return {
    groups: response.Groups ? response.Groups?.map((group) => group.GroupName).join() : '',
  };
};

export const removeUserFromGroup = async (userId: string, group: GroupName): Promise<void> => {
  const input: AdminRemoveUserFromGroupCommandInput = {
    UserPoolId: userPoolId,
    Username: userId,
    GroupName: group,
  };

  await client.send(new AdminRemoveUserFromGroupCommand(input));
};

export const deleteUser = async (userId: string): Promise<void> => {
  const input: AdminDeleteUserCommandInput = {
    UserPoolId: userPoolId,
    Username: userId,
  };

  await client.send(new AdminDeleteUserCommand(input));
};
