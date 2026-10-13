# 🍔 Sistema da Hamburgueria

Sistema completo: login com ADM e funcionários, dashboard, comandas, pagamentos por funcionário, caixa, produtos, relatórios, auditoria e backup. Tema preto e laranja.

## Arquitetura (por que assim)
- **Backend em Node.js** (sem dependências, nada de `npm install`) + **banco SQLite** (arquivo `data/hamburgueria.db`).
- Autenticação, permissões e regras de negócio ficam **no servidor**. O navegador só exibe telas.
- Funciona em **um computador** (loja) e também em **vários aparelhos** na mesma rede (Wi‑Fi/cabo): todos acessam o mesmo servidor e o mesmo banco. Por isso não usa `localStorage`.

## Instalar (uma vez)
1. Instale o **Node.js versão LTS (22.13 ou mais novo)**: https://nodejs.org
2. Descompacte esta pasta em qualquer lugar do computador da loja.

## Iniciar
- **Windows:** clique duas vezes em `INICIAR.bat` (abre o navegador sozinho).
- **Mac/Linux:** `./iniciar.sh` e abra http://localhost:3000
- Deixe a janela preta aberta enquanto usa o sistema. Para parar: feche a janela ou Ctrl+C.
- Outros aparelhos na mesma rede: use o endereço “Outros aparelhos” que aparece na janela (ex.: `http://192.168.0.10:3000`).
- Para abrir ao ligar o PC: coloque um atalho do `INICIAR.bat` na pasta *Inicializar* do Windows (`Win+R` → `shell:startup`).

## Primeiro acesso
Na primeira vez a tela de login pede para **criar o administrador** (nome, usuário e senha). Depois disso essa opção desaparece. Em seguida:
1. **Produtos** → cadastre o cardápio (foto, preço, custo, categoria, estoque opcional). Os “Adicionais” (ex.: bacon extra) aparecem como opções ao adicionar um item.
2. **Funcionários** → crie uma conta para cada pessoa e marque as permissões.
3. **Caixa** → abra o caixa com o valor inicial. **Sem caixa aberto não é possível receber pagamentos.**
4. **Comandas** → abra comandas, adicione itens, envie para preparo, receba e finalize.

## Como funciona
- **Login:** abas *Funcionário* / *Administrador*. Cada pessoa tem login próprio; o ADM pode bloquear a conta (a pessoa é desconectada na hora).
- **Permissões (por funcionário):** abrir/editar comandas · receber pagamentos · aplicar descontos · cancelar/remover itens e estornar · operar o caixa. Administrador tem tudo. Sem a permissão, o servidor recusa a ação.
- **Comandas:** número único (#001…), cliente, responsável, itens, adicionais, observações, desconto (com autorização), status *aberta → em preparo → pronta → finalizada* ou *cancelada* (motivo obrigatório). Itens de uma comanda já enviada ao preparo só podem ser alterados/removidos por quem tem permissão de cancelamento.
- **Vendido × recebido:** a comanda guarda **quem vendeu**; cada pagamento guarda **quem recebeu** e a forma (dinheiro/PIX/cartão). Um pagamento pode ser dividido em várias formas. O perfil do funcionário mostra separadamente o que ele vendeu e o que ele efetivamente recebeu (inclusive o que recebeu de vendas de outros e o que outros receberam das vendas dele).
- **Caixa:** abertura com valor inicial, reforço, sangria, despesa, entrada avulsa, fechamento com conferência do dinheiro físico (esperado × contado × diferença) e relatório por funcionário. Movimentações **não são editadas**: o administrador pode **estornar** informando o motivo, e tudo fica na auditoria.
- **Relatórios:** por dia/semana/mês, funcionário, produto, forma de pagamento, caixa/turno, cancelamentos e descontos. **Exportar CSV** (abre no Excel) e **Imprimir / salvar PDF** (na janela de impressão escolha “Salvar como PDF”).
- **Auditoria:** registra logins, vendas, descontos, cancelamentos, estornos, alterações de preço, caixa e cadastros, com quem fez e quando.
- **Estoque:** se o produto tiver controle de estoque, baixa ao adicionar na comanda e devolve ao remover/cancelar.

## Segurança
- Senhas guardadas com hash **scrypt** + sal (nunca em texto). Sessão por cookie `HttpOnly`/`SameSite=Strict`, expira em 12 h.
- Bloqueio temporário após 5 senhas erradas. Páginas e arquivos do ADM só são enviados pelo servidor a contas de administrador (digitar a URL não adianta).
- Se for usar **fora da rede da loja (internet)**, coloque atrás de HTTPS (ex.: Cloudflare Tunnel, Caddy ou nginx). Na rede local da loja não é necessário.

## Dados e backup
- Tudo fica na pasta `data/` (banco + fotos). **Os dados permanecem** ao fechar o navegador, reiniciar o PC ou atualizar o sistema.
- Faça backup: no sistema, **Auditoria → 💾 Baixar backup** (guarde em pendrive/nuvem), ou copie a pasta `data/` com o sistema fechado.
- Para restaurar: feche o sistema e substitua `data/hamburgueria.db` pelo arquivo de backup (renomeie para esse nome).

## Variáveis opcionais
`PORT=3000` (porta) · `HOST=127.0.0.1` (aceitar só o próprio computador) · `DATA_DIR=C:\dados\hamburgueria` (onde salvar os dados).

## Observações honestas
- O PDF é gerado pela impressão do navegador (“Salvar como PDF”); não há gerador de PDF no servidor.
- Não há emissão de nota fiscal nem integração automática com PIX/maquininha: o PIX e o cartão são **registrados** manualmente pelo funcionário que recebeu.
