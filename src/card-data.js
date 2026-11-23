export const MAX_IMPORT_CARDS = 3000;
export const MAX_COLLECTION_NAME = 80;

export function cardFieldIssue(prompt, answers) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > 500) {
    return '問題文を500文字以内で入力してください。';
  }
  if (!Array.isArray(answers) || !answers.length || answers.length > 20 ||
      !answers.every(answer => typeof answer === 'string' && answer.trim() && answer.trim().length <= 500)) {
    return '正解を20件まで入力してください（各500文字以内）。';
  }
  if (answers.join('\n').length > 3000) return '正解は合計3000文字以内で入力してください。';
  return '';
}
