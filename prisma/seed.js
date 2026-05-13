require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const CORES_PADRAO = [
  { nome: 'Lilás Pastel', hex: '#C8A8E9' },
  { nome: 'Azul Serenity', hex: '#92B4EC' },
  { nome: 'Rosa Quartzo', hex: '#F7B8C2' },
  { nome: 'Verde Menta', hex: '#98D9C2' },
  { nome: 'Dourado Champagne', hex: '#E8C97B' },
  { nome: 'Terracota', hex: '#E07B54' },
  { nome: 'Sálvia', hex: '#8FAE88' },
  { nome: 'Nude', hex: '#D4B896' },
  { nome: 'Azul Marinho', hex: '#2C4770' },
  { nome: 'Pérola', hex: '#F0EBE1' },
]

async function main() {
  console.log('🌸 Iniciando seed K&M...')

  // Criar evento padrão
  await prisma.evento.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      data: '15 de Novembro de 2025',
      horario: '17:00',
      local: 'Igreja São Paulo Apóstolo',
      mapsLink: 'https://maps.google.com',
    },
  })
  console.log('✅ Evento criado')

  // Criar cores
  for (const cor of CORES_PADRAO) {
    await prisma.cor.upsert({
      where: { id: CORES_PADRAO.indexOf(cor) + 1 },
      update: {},
      create: cor,
    })
  }
  console.log('✅ Cores criadas:', CORES_PADRAO.length)

  console.log('\n✨ Seed concluído com sucesso!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
