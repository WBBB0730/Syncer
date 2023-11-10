/** 随机生成n位数字的字符串 */
function randomNumber(n) {
    let result = ''
    for (let i = 0; i < n; i++)
        result += Math.floor(Math.random() * 10)
    return result
}

export {
  randomNumber
}
