# ELO Convoca+ | Alternar turno do pleito

Alterne entre o **1º e o 2º turno** no ELO Convoca+ com um clique e, se desejar, mantenha automaticamente o turno escolhido nas páginas de convocação.

## O que o script faz

O script adiciona um painel flutuante no canto inferior esquerdo da página, com dois controles do mesmo tamanho, organizados um abaixo do outro:

1. **Troca de turno:** mostra o turno atual e permite selecionar o outro turno.
2. **Persistência ON/OFF:** permite memorizar o turno de trabalho e reaplicá-lo automaticamente.

Reconhece os campos de pleito das consultas comum, completa e por inscrição/CPF, incluindo `pleito`, `pleitoCompleta` e `pleitoInscricao`.

## Troca manual de turno

Com a persistência desligada, o turno só é alterado quando você clica no botão.

- Se estiver no **1º turno**, o clique seleciona o **2º turno**.
- Se estiver no **2º turno**, o clique seleciona o **1º turno**.
- Se houver vários campos de pleito visíveis, todos são ajustados para o mesmo turno.
- Se os campos estiverem com turnos diferentes ou sem turno identificado, o botão oferece a seleção do **2º turno**.

Campos ocultos são ignorados.

## Persistência opcional

A persistência começa **desligada**, quando ainda não existe uma configuração salva.

| Estado | Comportamento |
| --- | --- |
| **OFF** | A troca ocorre somente pelo botão. |
| **ON** | O script memoriza o turno escolhido e o aplica aos campos visíveis nas páginas de convocação. |

Ao ligar a persistência, o script memoriza o turno atual. Se não conseguir identificar um turno único, usa a preferência anterior ou, na ausência dela, o 2º turno.

Ao trocar o turno pelo botão com a persistência ligada, o novo turno passa a ser a preferência memorizada.

A configuração fica salva no armazenamento local do navegador e pode ser recuperada após recarregar a página ou reabrir o navegador. Se o armazenamento estiver bloqueado, o controle informa, em sua descrição ao passar o mouse, que a configuração vale somente na página atual.

**Para trabalhar livremente com outro turno sem reaplicação automática, desligue a persistência.**

## Painel e navegação

- O painel aparece apenas na área de convocação e em suas subpáginas.
- Quando não encontra campos de turno visíveis, fica recolhido como uma pequena aba cinza à esquerda.
- Quando os campos aparecem, o painel se expande automaticamente.
- Acompanha a navegação interna do ELO, inclusive quando os campos são recriados pela página.
- Os controles ficam ocultos na impressão.

## Tratamento de falhas

O script confirma se a página aplicou o turno selecionado. Se a troca não for concluída em todos os campos, mostra quantos foram ajustados e permite tentar novamente com o mesmo turno de destino.

Uma falha na persistência interrompe novas tentativas automáticas, evitando repetição contínua. Você pode tentar novamente pelo botão. Ao sair da área de convocação, uma troca em andamento é cancelada.

## Como usar

1. Instale o script no Tampermonkey.
2. Abra ou recarregue o ELO Convoca+.
3. Acesse uma página da área de convocação que contenha o campo de pleito.
4. Use o botão superior para alternar o turno.
5. Se quiser manter o turno escolhido durante o trabalho, ative **Persistência ON** no controle inferior.

## Onde funciona

No endereço `https://cad-elo22.tse.jus.br/`, dentro da rota `#/main/convocacao` e de suas subpáginas, incluindo as telas de manutenção de convocação e vagas.

## Armazenamento e escopo

O script salva localmente apenas a configuração de persistência e o turno escolhido. Não contém chamadas de rede próprias para enviar dados a serviços externos. As seleções são feitas nos controles da própria página do ELO.

Sua função é ajustar o campo de pleito. Ele não preenche os demais dados nem executa pesquisas por conta própria.
