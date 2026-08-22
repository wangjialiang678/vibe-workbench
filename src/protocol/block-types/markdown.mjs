export default {
  type: 'markdown',
  hashFields: [],
  bodyAsContent: true,
  validate() { return []; },
  render(block, { mdToHtml }) { return mdToHtml(block.body ?? ''); },
};
