import {
  appendStreamEntry,
  claimInboxTask,
  completeInboxTask,
  enqueueInboxTask,
  listInboxTasks,
  renewInboxTask,
  MESSAGE_BODY_LIMIT,
  INBOX_REQUEST_LIMIT,
  AI_IDENTITY,
  respondInboxError,
} from '../server.mjs';

export function inbox(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath.startsWith('/api/inbox/')) {
    // 拉取执行器必须显式持有管理员口令；本地无口令的兼容 owner 不获得队列权限。
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员执行器可访问收件箱' });
      return;
    }
    const inboxOptions = { claimTimeoutMs: runtimeState.inboxClaimTimeoutMs };

    if (urlPath === '/api/inbox/tasks' && method === 'GET') {
      const executor = requestUrl.searchParams.get('executor');
      const status = requestUrl.searchParams.has('status')
        ? requestUrl.searchParams.get('status')
        : undefined;
      try {
        const tasks = listInboxTasks({ executor, status, ...inboxOptions });
        json(res, 200, { ok: true, tasks });
      } catch (error) {
        respondInboxError(res, error, '列表读取');
      }
      return;
    }

    if (urlPath === '/api/inbox/tasks' && method === 'POST') {
      readBody(req, INBOX_REQUEST_LIMIT).then((body) => {
        try {
          const task = enqueueInboxTask(body);
          console.error('[workbench:inbox] 任务入队：', {
            id: task.id,
            executor: task.executor,
            session: task.session,
            type: task.type,
          });
          json(res, 201, { ok: true, task });
        } catch (error) {
          respondInboxError(res, error, '入队');
        }
      }).catch((error) => {
        if (error?.code === 'BODY_TOO_LARGE') {
          json(res, 413, { ok: false, error: '收件箱请求体过大' });
          return;
        }
        json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
      });
      return;
    }

    const taskAction = urlPath.match(
      /^\/api\/inbox\/tasks\/([^/]+)\/(claim|renew|complete)$/,
    );
    if (taskAction && method === 'POST') {
      const [, id, action] = taskAction;
      readBody(req, MESSAGE_BODY_LIMIT).then((body) => {
        try {
          if (action === 'claim') {
            const task = claimInboxTask(id, body?.claimedBy, inboxOptions);
            console.error('[workbench:inbox] 租约已领取：', {
              id: task.id,
              claimedBy: task.claimedBy,
              leaseExpiresAt: task.leaseExpiresAt,
            });
            json(res, 200, { ok: true, task });
            return;
          }
          if (action === 'renew') {
            const task = renewInboxTask(id, body?.claimedBy, inboxOptions);
            console.error('[workbench:inbox] 租约已续期：', {
              id: task.id,
              claimedBy: task.claimedBy,
              leaseExpiresAt: task.leaseExpiresAt,
            });
            json(res, 200, { ok: true, task });
            return;
          }

          const completed = completeInboxTask(id, body, inboxOptions);
          if (!completed.idempotent) {
            appendStreamEntry(completed.task.session, {
              author: AI_IDENTITY,
              kind: completed.task.result.ok ? 'receipt' : 'message',
              text: completed.task.result.ok
                ? `任务执行完成：${completed.task.result.summary}`
                : `任务执行失败：${completed.task.result.summary}`,
            }, { exactSession: true });
            console.error('[workbench:inbox] 任务已完成：', {
              id: completed.task.id,
              status: completed.task.status,
              session: completed.task.session,
            });
          }
          json(res, 200, {
            ok: true,
            task: completed.task,
            idempotent: completed.idempotent,
          });
        } catch (error) {
          respondInboxError(res, error, action);
        }
      }).catch((error) => {
        if (error?.code === 'BODY_TOO_LARGE') {
          json(res, 413, { ok: false, error: '收件箱请求体过大' });
          return;
        }
        json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
      });
      return;
    }

    json(res, taskAction ? 405 : 404, {
      ok: false,
      error: taskAction ? 'method not allowed' : 'not found',
    });
    return;
  }

  return false;
}
