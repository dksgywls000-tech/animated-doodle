import type { FastifyInstance } from 'fastify';
import { requireUser, type AppDeps } from '../app.js';
import { deleteOwnMessage, listMessages, markRead, postMessage, reportMessage, resolveChannel, unreadCounts } from '../services/chat.js';

const wsChannel = (ch: string) => (ch === 'all' ? 'chat:all' : `chat:${ch}`);

export function registerChatRoutes(api: FastifyInstance, { config, db, hub }: AppDeps) {
  api.get<{ Params: { channel: string }; Querystring: { before?: string } }>('/chat/:channel/messages', async (req) => {
    const u = requireUser(req);
    const channel = resolveChannel(u, req.params.channel);
    return { channel, ...(await listMessages(db, config.eventId, channel, u.participantId, req.query.before)) };
  });

  api.post<{ Params: { channel: string } }>('/chat/:channel/messages', async (req) => {
    const u = requireUser(req);
    const channel = resolveChannel(u, req.params.channel);
    const result = await postMessage(db, config.eventId, u, channel, (req.body ?? {}) as { body: unknown; clientMsgId: unknown });
    if (!result.replay) {
      const { clientMsgId: _c, ...pub } = result.message;
      await hub.publish({ channel: wsChannel(channel), type: 'chat_message', data: pub });
    }
    return result;
  });

  api.post<{ Params: { channel: string } }>('/chat/:channel/read', async (req) => {
    const u = requireUser(req);
    await markRead(db, u, resolveChannel(u, req.params.channel));
    return { ok: true };
  });

  api.get('/chat/unread', async (req) => {
    const u = requireUser(req);
    return await unreadCounts(db, config.eventId, u);
  });

  api.delete<{ Params: { id: string } }>('/chat/messages/:id', async (req) => {
    const u = requireUser(req);
    const msg = await deleteOwnMessage(db, config.eventId, u, req.params.id);
    const { clientMsgId: _c, ...pub } = msg;
    await hub.publish({ channel: wsChannel(msg.channel), type: 'chat_update', data: pub });
    return { message: msg };
  });

  api.post<{ Params: { id: string } }>('/chat/messages/:id/report', async (req) => {
    const u = requireUser(req);
    await reportMessage(db, config.eventId, u, req.params.id, (req.body as { reason?: unknown } | undefined)?.reason);
    void hub.publish({ channel: 'admin', type: 'reports_changed' });
    return { ok: true };
  });
}
