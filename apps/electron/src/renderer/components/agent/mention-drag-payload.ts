import type { AgentPendingMention } from '../../atoms/agent-atoms';

/**
 * 创建 macOS Finder 风格的多文件拖拽鼠标预览：
 * 叠加文件方块 + 右上红色徽标显示数字 + 第一个文件名。
 *
 * 返回的元素已挂到 document.body（绝对定位、屏外），调用方在 `dragend` 时调用 `.remove()`。
 * 不需要 cleanup 时也可以 `setTimeout(() => el.remove(), 0)`，浏览器在当前 tick 完成 capture 后再移除。
 */
export function createMultiFileDragImage(count: number, label: string): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = [
    'position: fixed',
    'top: -1000px',
    'left: -1000px',
    'display: inline-flex',
    'align-items: center',
    'gap: 10px',
    'padding: 8px 14px 8px 12px',
    'background: rgba(255,255,255,0.96)',
    'border: 1px solid rgba(0,0,0,0.08)',
    'border-radius: 10px',
    'box-shadow: 0 6px 20px rgba(0,0,0,0.18)',
    'font: 12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    'color: #1d1d1f',
    'pointer-events: none',
    'z-index: 99999',
    'white-space: nowrap',
  ].join(';');

  const stack = document.createElement('div');
  stack.style.cssText = 'position: relative; width: 34px; height: 30px; flex-shrink: 0';

  // 错位叠加 3 层（不论实际数量，视觉就 3 层）
  const layers = Math.min(count, 3);
  for (let i = layers - 1; i >= 0; i--) {
    const sheet = document.createElement('div');
    sheet.style.cssText = [
      'position: absolute',
      `top: ${i * 3}px`,
      `left: ${i * 3}px`,
      'width: 24px',
      'height: 28px',
      'background: #fff',
      'border: 1px solid rgba(0,0,0,0.22)',
      'border-radius: 3px',
      'box-shadow: 0 1px 2px rgba(0,0,0,0.06)',
    ].join(';');
    stack.appendChild(sheet);
  }

  // 右上数字徽标
  const badge = document.createElement('div');
  badge.style.cssText = [
    'position: absolute',
    'top: -7px',
    'right: -8px',
    'min-width: 20px',
    'height: 20px',
    'padding: 0 5px',
    'background: #ff453a',
    'border: 2px solid #fff',
    'border-radius: 10px',
    'color: #fff',
    'font-size: 11px',
    'font-weight: 700',
    'line-height: 16px',
    'text-align: center',
    'box-sizing: border-box',
    'box-shadow: 0 1px 3px rgba(0,0,0,0.2)',
  ].join(';');
  badge.textContent = String(count);
  stack.appendChild(badge);

  root.appendChild(stack);

  const text = document.createElement('span');
  text.style.cssText = 'max-width: 240px; overflow: hidden; text-overflow: ellipsis;';
  text.textContent = label;
  root.appendChild(text);

  document.body.appendChild(root);
  return root;
}

export const MENTION_DRAG_MIME = 'application/x-asci-workspace-file';

export function buildFileMentionPayload(args: {
  relPath: string;
  name: string;
}): AgentPendingMention {
  return { kind: 'file', id: args.relPath, label: args.name };
}

/**
 * 解析 dataTransfer 里的 mention payload，统一返回数组。
 * 兼容两种序列化格式：
 *  - 单 mention 对象（单文件拖拽）
 *  - mention 数组（多文件拖拽）
 * 任一项格式不合法就跳过，整体不抛错。
 */
export function parseFileMentionPayloads(raw: string): AgentPendingMention[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    const items = Array.isArray(data) ? data : [data];
    const valid: AgentPendingMention[] = [];
    for (const obj of items) {
      const m = obj as Partial<AgentPendingMention> | null;
      if (m?.kind !== 'file') continue;
      if (typeof m.id !== 'string' || m.id.length === 0) continue;
      if (typeof m.label !== 'string' || m.label.length === 0) continue;
      valid.push({ kind: 'file', id: m.id, label: m.label });
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * 计算文件绝对路径相对于项目根的 POSIX 风格相对路径。
 * 当 absolutePath 不在 projectRoot 之下、或任一参数为空时返回 null。
 */
export function computeRelPath(
  absolutePath: string,
  projectRoot: string
): string | null {
  if (!absolutePath || !projectRoot) return null;
  const absNorm = absolutePath.replace(/\\/g, '/');
  const rootNorm = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!absNorm.startsWith(rootNorm + '/')) return null;
  return absNorm.slice(rootNorm.length + 1);
}
