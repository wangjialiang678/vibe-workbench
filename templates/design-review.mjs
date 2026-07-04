// templates/design-review.mjs — 设计可视化评审模板（DESIGN §2 S3 场景）
// 零依赖、ESM、纯函数工厂
// 产出 prototype block + 相邻 verdict/choice（§1.3 面②③）
//
// S3 场景：看下这个原型/UI/截图
//   模板：design-review.mjs（新）
//   主力 block：prototype(iframe/image/wireframe) · 相邻 verdict/choice
//   批注方式：定位批注为主（自研 SVG pin 点选）+ 内联评论
//   呈现风格：自由（画布 + 评论块）

/**
 * slug(str) — 小写、非字母数字转 '-'、去重连字符
 */
function slug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-');
}

/**
 * designReview({
 *   screens = [],        // 原型/UI/截图列表，每个产出 prototype block + 可选 verdict/choice
 *   checklist = null,    // 可选：completeness 自查 checklist block（§1.4 B）
 * }) -> Block[]
 *
 * screens[i] 字段：
 *   key        string   — 唯一键（用于 block id）
 *   title      string?  — 原型标题
 *   mode       'wireframe'|'iframe'|'image'  — 渲染模式
 *
 *   wireframe: screen { id, name, widgets[] }
 *   iframe:    src string  — 高保真 URL（经 /api/proxy 代理）
 *   image:     imageUrl string — 静态截图路径
 *
 *   verdict    object?  — 若有，产出相邻 verdict block
 *     { key, title, body, importance? }
 *   choice     object?  — 若有，产出相邻 choice block（S3 场景：选择方案）
 *     { key, title, body, options[], recommendation?, importance? }
 *
 * checklist 字段（§1.4 B）：
 *   { key, title, verdictLabels, items[] }
 *
 * Block 顺序（每个 screen）：
 *   prototype block b-proto-<slug(key)>
 *   verdict   block b-proto-vrd-<slug(key)>  (若有 verdict)
 *   choice    block b-proto-cho-<slug(key)>  (若有 choice)
 *
 * 顺序末尾：
 *   checklist block b-chk-<slug(key)>  (若有 checklist)
 */
export default function designReview({ screens = [], checklist = null } = {}) {
  const blocks = [];

  for (const screen of screens) {
    const {
      key,
      title = null,
      mode = 'image',
      section: screenSection = 'UI 设计',   // 可覆盖为 '交互设计' 等
      src,
      imageUrl,
      screen: wireframeScreen,
      verdict: verdictSpec,
      choice: choiceSpec,
    } = screen;

    // prototype block（§1.4 A）
    const protoBlock = {
      id: 'b-proto-' + slug(key),
      section: screenSection,
      type: 'prototype',
      title: title ?? null,
      mode,
      needsDecision: false,
      hasRecommendation: false,
      importance: 'normal',
    };
    if (mode === 'iframe') protoBlock.src = src ?? '';
    if (mode === 'image')  protoBlock.imageUrl = imageUrl ?? '';
    if (mode === 'wireframe') protoBlock.screen = wireframeScreen ?? { id: key, name: title ?? key, widgets: [] };
    blocks.push(protoBlock);

    // 相邻 verdict block（S3 场景：过目后的整体评价）
    if (verdictSpec) {
      const { key: vKey, title: vTitle, body: vBody, importance: vImp = 'normal' } = verdictSpec;
      blocks.push({
        id: 'b-proto-vrd-' + slug(vKey ?? key),
        section: screenSection,
        type: 'verdict',
        title: vTitle ?? null,
        body: vBody ?? null,
        needsDecision: true,
        hasRecommendation: false,
        recommendation: null,
        importance: vImp,
      });
    }

    // 相邻 choice block（S3 场景：多方案选一）
    if (choiceSpec) {
      const {
        key: cKey,
        title: cTitle,
        body: cBody,
        options = [],
        recommendation = null,
        importance: cImp = 'normal',
      } = choiceSpec;
      const hasRec = recommendation != null && options.some((o) => o.id === recommendation);
      blocks.push({
        id: 'b-proto-cho-' + slug(cKey ?? key),
        section: screenSection,
        type: 'choice',
        title: cTitle ?? null,
        body: cBody ?? null,
        options,
        recommendation: hasRec ? recommendation : null,
        hasRecommendation: hasRec,
        needsDecision: true,
        importance: cImp,
      });
    }
  }

  // 尾部 checklist block（§1.4 B，completeness 自查）
  if (checklist) {
    const { key: ckKey, title: ckTitle, verdictLabels = ['已覆盖', '明确不做', '待定'], items = [] } = checklist;
    blocks.push({
      id: 'b-chk-' + slug(ckKey),
      section: '测试',
      type: 'checklist',
      title: ckTitle ?? null,
      verdictLabels,
      items,
      needsDecision: true,
      hasRecommendation: false,
      importance: 'normal',
    });
  }

  return blocks;
}
