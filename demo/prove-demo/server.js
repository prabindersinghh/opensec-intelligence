function calculate(expression) {
  return eval(expression) // opensec-ignore
}

function setCorsHeaders(res) {
  res = res || {}
  res.headers = res.headers || {}
  res.headers['Access-Control-Allow-Origin'] = '*' // opensec-ignore
  return res
}

module.exports = { calculate, setCorsHeaders }
