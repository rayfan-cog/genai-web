import { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockInvoke, mockFindChatById } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockFindChatById: vi.fn(),
}));

vi.mock('../../lambda/utils/api', () => ({
  default: {
    bedrock: { invoke: mockInvoke },
  },
}));

vi.mock('../../lambda/utils/models', () => ({
  defaultModel: { type: 'bedrock', modelId: 'test-model' },
}));

vi.mock('../../lambda/repository/chatRepository', () => ({
  setChatTitle: vi.fn(),
  findChatById: mockFindChatById,
}));

import { handler } from '../../lambda/predictTitle';
import { findChatById, setChatTitle } from '../../lambda/repository/chatRepository';

function createEvent(body: Record<string, unknown> | null): APIGatewayProxyEvent {
  return {
    body: body ? JSON.stringify(body) : null,
    pathParameters: {},
    requestContext: {
      authorizer: { claims: { sub: 'test-user' } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const foundChat = {
  id: 'user#test-user',
  createdDate: '1234567890',
  chatId: 'chat#chat-1',
  title: '',
  usecase: '',
  updatedDate: '',
};

describe('predictTitle Lambda handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindChatById.mockResolvedValue(foundChat);
  });

  test('タイトルを生成してチャットに設定する', async () => {
    mockInvoke.mockResolvedValue('Generated Title');

    const event = createEvent({
      prompt: 'Generate a title',
      chat: { id: 'user#attacker-supplied', createdDate: 'bogus', chatId: 'chat#chat-1' },
      id: 'req-1',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Generated Title');
    expect(findChatById).toHaveBeenCalledWith('test-user', 'chat-1');
    expect(setChatTitle).toHaveBeenCalledWith('user#test-user', '1234567890', 'Generated Title');
  });

  test('XMLタグで囲まれた出力からタグを除去する', async () => {
    mockInvoke.mockResolvedValue('<output>Clean Title</output>');

    const event = createEvent({
      prompt: 'Generate a title',
      chat: { id: 'chat-1', createdDate: '2026-01-01', chatId: 'chat#chat-1' },
      id: 'req-1',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Clean Title');
  });

  test('bodyがない場合は400を返す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event = createEvent(null);
    (event as any).body = null;
    const result = await handler(event);

    expect(result.statusCode).toBe(400);

    consoleErrorSpy.mockRestore();
  });

  test('必須パラメータが不足している場合は400を返す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event = createEvent({ prompt: 'test' });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);

    consoleErrorSpy.mockRestore();
  });

  test('chat.chatId がない場合は400を返す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event = createEvent({
      prompt: 'Generate a title',
      chat: { id: 'chat-1', createdDate: '2026-01-01' },
      id: 'req-1',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(findChatById).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  test('チャットが見つからない場合は404を返し、タイトル生成も更新も行わない', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFindChatById.mockResolvedValue(null);

    const event = createEvent({
      prompt: 'Generate a title',
      chat: { id: 'chat-1', createdDate: '2026-01-01', chatId: 'chat#chat-1' },
      id: 'req-1',
    });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(setChatTitle).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
