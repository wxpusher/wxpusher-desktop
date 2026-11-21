/**
 * 字符串工具，方法名和服务端 StringUtil、app-fe StringUtil 对齐。
 */
export default class StringUtil {
  /**
   * 截取到不超过 length 个字符，和服务端 StringUtil.getStringLessLength 一致：
   * 长度按 str.length（UTF-16）计算，切点落在表情、生僻字等代理对中间时往前退一位，不会留下半个字符显示成乱码。
   * 不要直接用 slice / substring 截用户内容。
   */
  static getStringLessLength(str: string, length: number): string {
    if (!str || str.length <= length) {
      return str;
    }
    let end = Math.max(0, length);
    if (end > 0 && StringUtil.isHighSurrogate(str.charCodeAt(end - 1)) && StringUtil.isLowSurrogate(str.charCodeAt(end))) {
      end--;
    }
    return str.substring(0, end);
  }

  private static isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
  }

  private static isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
  }
}
