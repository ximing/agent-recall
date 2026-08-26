import { observer, useService } from '@rabjs/react';
import { MarkdownView } from '@/components/MarkdownView';
import { OpsService } from '../ops.service';

export const FeedPanel = observer(function FeedPanel() {
  const service = useService(OpsService);
  return (
    <div className="panel ops-card">
      <div className="ops-card-head">
        <h2>收到的分享</h2>
        {service.feed.length > 0 ? <span className="mini-tag">{service.feed.length} 条</span> : null}
      </div>
      <p className="desc">这里是你库里带 shared 标签的记忆，也就是别人复制给你的那一份。</p>
      {service.feed.length === 0 ? (
        <p className="composer-hint">还没有人分记忆过来。</p>
      ) : (
        service.feed.map((memory) => <MarkdownView key={memory.id} content={memory.content} clamp />)
      )}
    </div>
  );
});
