# NEBLK — Streetwear Store / Premium Edition

Loja virtual self-hosted para a NEBLK, pensada para rodar no seu computador com Docker e ser publicada para todo o Brasil em:

- Loja pública: `https://www.neblk.com.br`
- Painel interno: `https://admin.neblk.com.br`

A loja é responsiva e tem navegação própria para celular, com menu mobile, barra inferior, checkout adaptado e páginas de produto/drops em tela pequena.

---

## O que esta versão entrega

### Loja pública

- Home moderna no estilo streetwear: preto, grafite, roxo e estética editorial.
- Catálogo de produtos, categorias e filtros.
- Página de produto com variantes, fotos, estoque e carrinho.
- Menu **DROPS** com expansão ao passar o mouse e links individuais.
- Página `/drops` com todos os drops e página exclusiva para cada lançamento.
- Banner, título, chamada e descrição próprios para cada drop.
- Responsividade real para desktop, tablet e celular.
- Login, criação de conta, recuperação de senha e perfil de cliente.
- Carrinho sem obrigar login; **checkout somente após login**.
- Checkout com nome, WhatsApp, CEP, endereço e dados salvos no perfil.
- Busca automática de endereço por CEP.
- Pix/manual como meios de pagamento desta versão.

### Área do cliente

- Nome do cliente aparece no topo após login.
- Página **Perfil** para atualizar nome, WhatsApp, CPF e endereço.
- Alteração de senha dentro da conta.
- Histórico de pedidos e detalhes de cada pedido.
- Recuperação de senha por e-mail quando SMTP estiver configurado.

### Painel administrativo

- Dashboard de vendas, pedidos, metas, produtos vistos e produtos vendidos.
- Cadastro e edição de produtos com fotos, preço, estoque e tamanhos.
- Menu **Drops** para:
  - cadastrar Drop 01, Drop 02, Drop 03 etc.;
  - escolher nome, descrição e chamada curta;
  - enviar banner ou informar URL de banner;
  - ativar/arquivar drops;
  - alterar a ordem de exibição com botões ↑ e ↓.
- Pedidos, métricas, meta mensal, Pix e links de redes sociais.
- Política de frete configurável: “a confirmar” ou valor fixo/grátis acima de determinado valor.

---

# Requisitos no computador servidor

1. **Windows 10 ou 11** atualizado.
2. **Docker Desktop** instalado e iniciado.
3. Pelo menos 4 GB de RAM livres enquanto o Docker estiver em uso.
4. Internet estável para publicação externa.
5. Para domínio público: domínio `neblk.com.br` registrado e uma conta Cloudflare.

> Não é necessário instalar Node.js no computador do cliente/usuário final. O Docker instala e executa tudo dentro dos containers.

---

# Primeiro uso local

## 1. Extraia o projeto

Exemplo:

```powershell
cd "C:\Users\Tsoluções\Desktop\Controle Pessoal\Projetos\site"
```

Extraia a pasta do projeto como:

```text
neblk-premium
```

Entre nela:

```powershell
cd .\neblk-premium\
```

## 2. Crie o arquivo de configuração

```powershell
Copy-Item .env.example .env
notepad .env
```

No arquivo `.env`, altere pelo menos:

```env
ADMIN_EMAIL=admin@neblk.com.br
ADMIN_PASSWORD=coloque-uma-senha-forte-aqui
PIX_KEY=sua-chave-pix
PIX_BENEFICIARY=Nome do beneficiário
```

Salve e feche o Bloco de Notas.

## 3. Inicie a loja

```powershell
docker compose up -d --build
```

Confira o status:

```powershell
docker compose ps
```

Você deve ver o serviço `neblk` como `running` ou `Up`.

Abra no navegador:

```text
http://localhost:3000
```

---

# Atualizando da versão anterior sem perder produtos, contas e pedidos

Faça este processo **antes de iniciar a nova pasta**.

## 1. Pare a versão antiga

Dentro da pasta antiga:

```powershell
docker compose down
```

## 2. Faça uma cópia de segurança

Copie estes itens da pasta antiga para um local seguro:

```text
data\neblk.db
public\uploads\
.env
```

## 3. Leve os dados para a nova versão

Na nova pasta do projeto:

```powershell
Copy-Item "CAMINHO-DA-PASTA-ANTIGA\data\neblk.db" ".\data\neblk.db" -Force
Copy-Item "CAMINHO-DA-PASTA-ANTIGA\public\uploads\*" ".\public\uploads\" -Recurse -Force
Copy-Item "CAMINHO-DA-PASTA-ANTIGA\.env" ".\.env" -Force
```

## 4. Suba a nova versão

```powershell
docker compose build --no-cache
docker compose up -d
```

As migrações desta versão adicionam os campos de perfil, banner de drops e recuperação de senha sem apagar produtos, clientes ou pedidos existentes.

---

# Como usar o painel admin

Localmente:

```text
http://localhost:3000/admin/dashboard
```

Em produção:

```text
https://admin.neblk.com.br
```

Use o e-mail e senha definidos em `ADMIN_EMAIL` e `ADMIN_PASSWORD` antes da criação inicial do banco.

> Depois que o banco já existe, alterar `ADMIN_PASSWORD` no `.env` não muda a senha atual. Para trocar, use **Admin → Configurações → Alterar senha admin**.

---

# Cadastrar Drops

No painel, abra:

```text
Drops
```

Clique em **Criar Drop** e preencha:

- Nome: `Drop 02`, `Winter 2026`, `Nocturne`, etc.
- Chamada curta: exemplo `LIMITED RELEASE`.
- Descrição.
- Banner por URL ou upload de imagem.
- Ativo/inativo.

Depois cadastre produtos e escolha esse Drop no campo **Drop / coleção** do formulário do produto.

A ordem configurada no Admin aparece automaticamente:

- no menu superior **DROPS**;
- no menu do celular;
- na página `/drops`;
- na página individual de cada Drop.

---

# Perfil, login e checkout

- Sem login, o cliente pode navegar e colocar peças na Bag.
- Ao clicar em finalizar, ele é levado para login/cadastro.
- Depois do login, deve preencher nome, WhatsApp e endereço completo.
- O CEP tenta preencher rua, bairro, cidade e UF automaticamente.
- Os dados ficam salvos em **Perfil** para agilizar pedidos futuros.

---

# Recuperação de senha por e-mail

O fluxo de “Esqueci minha senha” está pronto, mas precisa de um servidor SMTP configurado para enviar e-mails de verdade.

Adicione estas linhas ao `.env`:

```env
SMTP_HOST=smtp.seuprovedor.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario-smpt
SMTP_PASS=senha-ou-app-password
SMTP_FROM=NEBLK <no-reply@neblk.com.br>
```

Depois reinicie:

```powershell
docker compose up -d --build
```

Sem SMTP, o sistema não envia o e-mail ao cliente. Para teste local, o link de redefinição aparece nos logs:

```powershell
docker compose logs -f neblk
```

Nunca use uma senha pessoal comum de e-mail. Prefira senha de aplicativo ou um provedor SMTP próprio.

---

# Frete

Esta versão possui duas políticas funcionais, configuradas em **Admin → Configurações → Política de entrega**:

1. **Calcular depois do pedido**: o pedido é registrado e a NEBLK confirma o valor/transportadora depois.
2. **Valor fixo no checkout**: exibe um preço fixo e pode liberar frete grátis acima de determinado subtotal.

## Frete real por transportadora

Cotação real depende de uma conta ativa e credenciais de uma plataforma de frete, além dos dados da operação: CEP de origem, peso, altura, largura, comprimento e contrato/serviços habilitados.

Não é seguro fingir que uma cotação é “real” sem essas credenciais. Quando a NEBLK escolher o parceiro de frete, a integração deve ser configurada com as chaves dele em variáveis de ambiente — não no código e nunca no front-end.

---

# Publicar para outros estados com www.neblk.com.br

Para a loja ficar disponível fora da sua rede, o computador precisa ficar ligado, com internet e Docker aberto. A publicação recomendada é via **Cloudflare Tunnel**.

## 1. Prepare o domínio

- Registre `neblk.com.br` em nome do cliente.
- Adicione o domínio na Cloudflare.
- Troque os nameservers no registrador pelo par informado pela Cloudflare.

## 2. Configure produção

No projeto:

```powershell
Copy-Item .env.production.example .env
notepad .env
```

Preencha principalmente:

```env
APP_URL=https://www.neblk.com.br
ADMIN_URL=https://admin.neblk.com.br
COOKIE_SECURE=true
COOKIE_DOMAIN=.neblk.com.br
ALLOWED_HOSTS=www.neblk.com.br,admin.neblk.com.br,neblk.com.br
CLOUDFLARE_TUNNEL_TOKEN=COLE_O_TOKEN_AQUI
```

## 3. Crie o Tunnel

No painel Cloudflare Zero Trust:

```text
Networks → Connectors → Cloudflare Tunnels → Create a tunnel
```

Escolha Docker, crie um tunnel como `neblk-servidor` e copie o token para `CLOUDFLARE_TUNNEL_TOKEN`.

## 4. Adicione duas rotas públicas

Dentro do tunnel, cadastre:

| Hostname | Service |
|---|---|
| `www.neblk.com.br` | `http://neblk:3000` |
| `admin.neblk.com.br` | `http://neblk:3000` |

## 5. Inicie site + Tunnel

```powershell
docker compose --profile tunnel up -d --build
```

Verifique:

```powershell
docker compose ps
docker compose logs -f cloudflared
```

Teste usando o celular no 4G:

```text
https://www.neblk.com.br
https://admin.neblk.com.br
```

---

# Proteger o painel admin

Além do login interno do sistema, proteja `admin.neblk.com.br` no Cloudflare Access.

No Cloudflare Zero Trust, crie uma aplicação de acesso para o hostname `admin.neblk.com.br` e permita somente os e-mails da equipe NEBLK. Assim, a pessoa precisa passar pela proteção Cloudflare **e** pelo login do painel.

---

# Comandos úteis

## Iniciar

```powershell
docker compose up -d
```

## Iniciar com Cloudflare Tunnel

```powershell
docker compose --profile tunnel up -d
```

## Parar

```powershell
docker compose down
```

## Ver logs do site

```powershell
docker compose logs -f neblk
```

## Ver logs do Tunnel

```powershell
docker compose logs -f cloudflared
```

## Ver containers e status

```powershell
docker compose ps
```

## Reconstruir depois de atualizar arquivos

```powershell
docker compose build --no-cache
docker compose up -d
```

---

# Backup obrigatório

Os dados importantes ficam em:

```text
data\neblk.db
public\uploads\
.env
```

Faça backup desses três itens regularmente em outro disco ou nuvem privada.

Exemplo simples no PowerShell:

```powershell
$destino = "D:\Backup-NEBLK\$(Get-Date -Format 'yyyy-MM-dd-HHmm')"
New-Item -ItemType Directory -Path $destino -Force
Copy-Item .\data\neblk.db $destino -Force
Copy-Item .\public\uploads $destino\uploads -Recurse -Force
Copy-Item .\.env $destino -Force
```

---

# Solução de problemas

## `localhost:3000` não abre

```powershell
docker compose ps
docker compose logs --tail=120 neblk
```

## Alterei arquivos e nada mudou

```powershell
docker compose build --no-cache
docker compose up -d
```

## `www.neblk.com.br` não abre, mas localhost abre

Confira:

```powershell
docker compose --profile tunnel up -d
docker compose logs -f cloudflared
```

Também verifique nameservers, rotas do Tunnel e token no `.env`.

## Cliente não recebe recuperação de senha

Verifique `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`, depois:

```powershell
docker compose logs --tail=120 neblk
```

---

# Observação de operação

Hospedar em um computador próprio funciona para início e testes, mas a loja fica offline se o computador, Docker ou internet parar. Quando a NEBLK tiver vendas frequentes, a evolução recomendada é mover o mesmo projeto Docker para uma VPS 24 horas por dia, mantendo domínio, banco e painel.
