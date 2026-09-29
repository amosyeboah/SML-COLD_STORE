(async () => {
  const fs = require('fs')
  const fetch = global.fetch || require('node-fetch')
  try {
    const productsRes = await fetch('http://127.0.0.1:4821/api/products')
    const products = await productsRes.json()
    if (!products || !products.length) {
      fs.writeFileSync('scripts/delete-result.json', JSON.stringify({ error: 'no-products' }, null, 2))
      return
    }
    const id = products[0].id
    const delRes = await fetch(`http://127.0.0.1:4821/api/products/${id}`, { method: 'DELETE' })
    const delBody = await delRes.text()
    fs.writeFileSync('scripts/delete-result.json', JSON.stringify({ id, status: delRes.status, body: delBody }, null, 2))
  } catch (err) {
    fs.writeFileSync('scripts/delete-result.json', JSON.stringify({ error: String(err) }, null, 2))
  }
})()
