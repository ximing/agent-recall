import { observer, useService } from '@rabjs/react';
import { MarkdownView } from '@/components/MarkdownView';
import { OpsService } from '../ops.service';

export const FeedPanel = observer(function FeedPanel() {
  const service = useService(OpsService);
  return (
    <div className="panel ops-card">
      <div className="ops-card-head">
        <h2>收到的分享</h2>
        {service.invites.length > 0 ? <span className="mini-tag">{service.invites.length} 条待接受</span> : null}
        {service.feed.length > 0 ? <span className="mini-tag">{service.feed.length} 条</span> : null}
      </div>
      {service.invites.length > 0 ? (
        <div className="kv-list" style={{ marginBottom: 12 }}>
          <p className="composer-hint">待接受的邀请。接受后才会复制进你的库。</p>
          {service.invites.map((invite) => (
            <div key={invite.id} className="kv-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{invite.fromDisplayName || invite.fromEmail}</strong>
                <p className="composer-hint">
                  {invite.fromEmail}
                  {invite.project ? ` · ${invite.project}` : ''}
                </p>
                <MarkdownView content={invite.content} clamp />
              </div>
              <span className="revoke-confirm">
                <button type="button" className="btn" onClick={() => void service.acceptInvite(invite.id)}>
                  接受
                </button>
                <button type="button" className="btn" onClick={() => void service.rejectInvite(invite.id)}>
                  拒绝
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="desc">这里是你库里带 shared 标签的记忆，也就是别人复制给你的那一份。</p>
      {service.feed.length === 0 ? (
        service.invites.length === 0 ? <p className="composer-hint">还没有人分记忆过来。</p> : null
      ) : (
        service.feed.map((memory) => <MarkdownView key={memory.id} content={memory.content} clamp />)
      )}
    </div>
  );
});
