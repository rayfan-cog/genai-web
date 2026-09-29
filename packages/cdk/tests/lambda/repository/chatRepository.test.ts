// client.ts は import 時に process.env.TABLE_NAME を解決するため、
// vi.hoisted で import 前に env を設定する。
import { vi } from 'vitest';
vi.hoisted(() => {
  process.env.TABLE_NAME = 'test-table';
  process.env.TTL_DAYS = '30';
});

import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { setChatTitle } from '../../../lambda/repository/chatRepository';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('chatRepository.setChatTitle', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(UpdateCommand).resolves({ Attributes: { title: 'new title' } });
  });

  it('UpdateCommand に既存チャット項目のみ更新可能な ConditionExpression が含まれる', async () => {
    await setChatTitle('user#test-user', '1234567890', 'new title');

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls.length).toBe(1);
    const input = calls[0].args[0].input;
    expect(input.ConditionExpression).toBe(
      'attribute_exists(chatId) AND begins_with(id, :userPrefix)',
    );
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':title': 'new title',
      ':userPrefix': 'user#',
    });
  });

  it('Key に指定された id と createdDate が使われる', async () => {
    await setChatTitle('user#test-user', '1234567890', 'new title');

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.Key).toEqual({ id: 'user#test-user', createdDate: '1234567890' });
  });
});
