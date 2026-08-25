# Guia complementar — NEBLK com Docker e Cloudflare Tunnel

O passo a passo completo de instalação, publicação, operação e backup está no arquivo principal:

```text
README.md
```

## Endereços finais

| Área | Endereço |
|---|---|
| Loja pública | `https://www.neblk.com.br` |
| Painel administrativo | `https://admin.neblk.com.br` |

## Rota correta no Cloudflare Tunnel

Como o Cloudflare Tunnel é executado dentro do mesmo Docker Compose da aplicação, as duas rotas publicadas devem apontar para:

```text
http://neblk:3000
```

Não use `http://localhost:3000` para as rotas do túnel em Docker. Dentro do container `cloudflared`, `localhost` significa o próprio container do túnel, não o container da loja.

## Comandos rápidos

```powershell
# iniciar loja e túnel
docker compose --profile tunnel up -d --build

# ver estado dos containers
docker compose ps

# logs da loja
docker compose logs -f neblk

# logs do túnel
docker compose logs -f cloudflared

# parar sem remover dados
docker compose stop
```

Leia o `README.md` antes do primeiro deploy.
