// VULN 6: eval() on user input
function calculate(expression) {
  return eval(expression) // opensec-ignore
}

// VULN 7: CORS wildcard
function setCorsHeaders(res) {
  res = res || {}
  res.headers = res.headers || {}
  res.headers['Access-Control-Allow-Origin'] = '*' // opensec-ignore
  return res
}

module.exports = { calculate, setCorsHeaders }
