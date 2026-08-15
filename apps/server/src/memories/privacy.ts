/**
 * 写入前的隐私清洗：剥离 API key、bearer token、PEM 私钥块、URL 内嵌凭据。
 * 所有写入路径（hooks 事件、agent 保存、导入）统一走这里。
 */

const PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // PEM 私钥/证书块
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: '[REDACTED:PRIVATE_KEY]' },
  // Bearer / Authorization 头
  { re: /\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: '$1 [REDACTED]' },
  // 常见 API key 形态：sk-xxx、ak/sk 长串、aws access key
  { re: /\b(sk|pk|ak|api[_-]?key|token|secret|password|passwd|pwd)(["'\s:=]+)[A-Za-z0-9._~+/=-]{12,}/gi, replace: '$1$2[REDACTED]' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: '[REDACTED:API_KEY]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[REDACTED:AWS_KEY]' },
  // agent-recall 自身 token
  { re: /\barm_[A-Za-z0-9]{16,}\b/g, replace: '[REDACTED:AR_TOKEN]' },
  // URL 内嵌凭据 https://user:pass@host
  { re: /(https?|postgres(?:ql)?|mysql|redis|mongodb):\/\/[^/\s:@]+:[^/\s@]+@/gi, replace: '$1://[REDACTED]@' },
  // 显式 <private> 标签包裹内容
  { re: /<private>[\s\S]*?<\/private>/gi, replace: '[REDACTED:PRIVATE]' },
];

export function redactSecrets(content: string): { content: string; redacted: boolean } {
  let out = content;
  let redacted = false;
  for (const { re, replace } of PATTERNS) {
    const next = out.replace(re, replace);
    if (next !== out) {
      redacted = true;
      out = next;
    }
  }
  return { content: out, redacted };
}
