require('dotenv').config()
const fastify = require('fastify')({ logger: true })
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// ─── CORS ────────────────────────────────────────────────────────────────────
fastify.register(require('@fastify/cors'), {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})

const path = require('path')
const fs = require('fs')
const util = require('util')
const { pipeline } = require('stream')
const pump = util.promisify(pipeline)

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)

fastify.register(require('@fastify/multipart'), {
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
})

fastify.register(require('@fastify/static'), {
  root: uploadsDir,
  prefix: '/uploads/',
})

/** POST /api/upload — upload de mídia */
fastify.post('/api/upload', async (req, reply) => {
  const data = await req.file()
  if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })
  
  const ext = path.extname(data.filename)
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
  const filepath = path.join(uploadsDir, filename)
  
  await pump(data.file, fs.createWriteStream(filepath))
  
  const url = `${process.env.VITE_API_URL || 'http://localhost:3001'}/uploads/${filename}`
  return { url }
})

// ─── HEALTH ──────────────────────────────────────────────────────────────────
fastify.get('/health', async () => ({ status: 'ok', system: 'K&M' }))

// ─── EVENTO ──────────────────────────────────────────────────────────────────

/** GET /api/evento — retorna dados do evento */
fastify.get('/api/evento', async (req, reply) => {
  try {
    let evento = await prisma.evento.findUnique({ where: { id: 1 } })
    if (!evento) {
      evento = await prisma.evento.create({
        data: {
          id: 1,
          data: '',
          horario: '',
          local: '',
          mapsLink: '',
        },
      })
    }
    return evento
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** PUT /api/admin/evento — atualiza dados do evento */
fastify.put('/api/admin/evento', async (req, reply) => {
  const { data, horario, local, mapsLink } = req.body
  try {
    const evento = await prisma.evento.upsert({
      where: { id: 1 },
      update: { data, horario, local, mapsLink },
      create: { id: 1, data, horario, local, mapsLink },
    })
    return evento
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

// ─── CORES ───────────────────────────────────────────────────────────────────

/** GET /api/cores — lista todas as cores com status de disponibilidade */
fastify.get('/api/cores', async (req, reply) => {
  try {
    const cores = await prisma.cor.findMany({
      include: {
        padrinhos: {
          select: { id: true, nome: true, tipo: true },
        },
      },
      orderBy: { id: 'asc' },
    })
    return cores.map((c) => ({
      ...c,
      disponivel: c.padrinhos.length === 0,
      reservadoPor: c.padrinhos[0] ?? null,
    }))
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** POST /api/admin/cores — cria nova cor */
fastify.post('/api/admin/cores', async (req, reply) => {
  const { nome, hex } = req.body
  try {
    const cor = await prisma.cor.create({ data: { nome, hex } })
    return cor
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** DELETE /api/admin/cores/:id — remove uma cor */
fastify.delete('/api/admin/cores/:id', async (req, reply) => {
  const { id } = req.params
  try {
    await prisma.cor.delete({ where: { id: Number(id) } })
    return { success: true }
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

// ─── PADRINHOS ───────────────────────────────────────────────────────────────

/** GET /api/padrinhos/:id — retorna dados de um padrinho e marca como visualizado */
fastify.get('/api/padrinhos/:id', async (req, reply) => {
  const { id } = req.params
  try {
    const padrinho = await prisma.padrinho.findUnique({
      where: { id },
      include: { cor: true },
    })
    if (!padrinho) return reply.status(404).send({ error: 'Padrinho não encontrado' })

    // Marcar como visualizado (sem await para não atrasar a resposta)
    if (!padrinho.visualizado) {
      prisma.padrinho.update({
        where: { id },
        data: { visualizado: true },
      }).catch(() => {})
    }

    return padrinho
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** POST /api/confirmar — confirma presença, recusa, e escolha de cor */
fastify.post('/api/confirmar', async (req, reply) => {
  const { padrinhoId, corId, status } = req.body
  try {
    const padrinho = await prisma.padrinho.findUnique({ where: { id: padrinhoId } })
    if (!padrinho) return reply.status(404).send({ error: 'Convite não encontrado' })

    const novoStatus = status || 'confirmado'

    if (novoStatus === 'confirmado' && padrinho.tipo !== 'convidado' && !corId) {
       return reply.status(400).send({ error: 'Escolha uma cor de traje' })
    }

    if (corId && novoStatus === 'confirmado') {
      // Verificar se cor já foi tomada por outro
      const cor = await prisma.cor.findUnique({
        where: { id: Number(corId) },
        include: { padrinhos: true },
      })

      if (!cor) return reply.status(404).send({ error: 'Cor não encontrada' })

      const jaTomada = cor.padrinhos.some((p) => p.id !== padrinhoId)
      if (jaTomada) {
        return reply.status(409).send({ error: 'Cor já escolhida por outra pessoa' })
      }
    }

    const atualizado = await prisma.padrinho.update({
      where: { id: padrinhoId },
      data: {
        corId: (novoStatus === 'confirmado' && corId) ? Number(corId) : null,
        status: novoStatus,
      },
      include: { cor: true },
    })

    return atualizado
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

// ─── ADMIN: PADRINHOS ────────────────────────────────────────────────────────

/** GET /api/admin/padrinhos — lista todos com cor e status */
fastify.get('/api/admin/padrinhos', async (req, reply) => {
  try {
    const padrinhos = await prisma.padrinho.findMany({
      include: { cor: true },
      orderBy: { createdAt: 'asc' },
    })
    return padrinhos
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** POST /api/admin/padrinhos — cria novo padrinho */
fastify.post('/api/admin/padrinhos', async (req, reply) => {
  const { nome, tipo } = req.body
  try {
    const padrinho = await prisma.padrinho.create({
      data: { nome, tipo: tipo ?? 'padrinho' },
    })
    return padrinho
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** PUT /api/admin/padrinhos/:id — atualiza padrinho */
fastify.put('/api/admin/padrinhos/:id', async (req, reply) => {
  const { id } = req.params
  const { nome, tipo, status, corId } = req.body
  try {
    const atualizado = await prisma.padrinho.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome }),
        ...(tipo !== undefined && { tipo }),
        ...(status !== undefined && { status }),
        ...(corId !== undefined && { corId: corId ? Number(corId) : null }),
      },
      include: { cor: true },
    })
    return atualizado
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** DELETE /api/admin/padrinhos/:id — remove padrinho */
fastify.delete('/api/admin/padrinhos/:id', async (req, reply) => {
  const { id } = req.params
  try {
    await prisma.padrinho.delete({ where: { id } })
    return { success: true }
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

// ─── ADMIN: MAPA DE CORES ────────────────────────────────────────────────────

/** GET /api/admin/mapa-cores — visão rápida do mapa de cores */
fastify.get('/api/admin/mapa-cores', async (req, reply) => {
  try {
    const cores = await prisma.cor.findMany({
      include: {
        padrinhos: {
          select: { id: true, nome: true, tipo: true, status: true },
        },
      },
      orderBy: { id: 'asc' },
    })
    return cores
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})



// ─── ALBUM VIRTUAL ───────────────────────────────────────────────────────────

/** GET /api/album — lista todas as mensagens do álbum */
fastify.get('/api/album', async (req, reply) => {
  try {
    const entries = await prisma.albumEntry.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return entries
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** POST /api/album — cria uma nova entrada no álbum */
fastify.post('/api/album', async (req, reply) => {
  const { tipo, conteudo, valor, autor } = req.body
  try {
    const entry = await prisma.albumEntry.create({
      data: {
        tipo,
        conteudo,
        valor: valor ? parseFloat(valor) : null,
        autor
      },
    })
    return entry
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

/** DELETE /api/admin/album/:id — remove uma entrada do álbum */
fastify.delete('/api/admin/album/:id', async (req, reply) => {
  const { id } = req.params
  try {
    await prisma.albumEntry.delete({ where: { id: Number(id) } })
    return { success: true }
  } catch (err) {
    reply.status(500).send({ error: err.message })
  }
})

// ─── START ───────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`\n🌸 K&M Backend rodando em http://localhost:${port}\n`)

    // Cron / Keep-Alive para evitar que o servidor durma no Render (pinga a cada 14 minutos)
    const pingInterval = 14 * 60 * 1000 // 14 minutos
    setInterval(() => {
      const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`
      fetch(`${url}/health`)
        .then(res => console.log(`[Keep-Alive] Ping em ${url}/health: ${res.status}`))
        .catch(err => console.error(`[Keep-Alive] Erro ao pingar:`, err.message))
    }, pingInterval)
    
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
