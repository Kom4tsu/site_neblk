const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
['neblk.db', 'neblk.db-wal', 'neblk.db-shm'].forEach((file) => {
  const target = path.join(dataDir, file);
  if (fs.existsSync(target)) fs.unlinkSync(target);
});
console.log('Banco removido. Inicie a aplicação novamente para recriar os dados de demonstração.');
