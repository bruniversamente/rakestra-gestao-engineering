# Acesso por clube e unidade

## Situação

A mesma pessoa pode ter acesso à agenda e não ao financeiro, ou atuar apenas em determinadas unidades.

## Escolha na implementação

A política de rotas combina capacidade contratada, liberação operacional, permissão e unidade. O serviço do backend verifica o acesso antes das operações pertinentes.

## Consequências

A interface explica ou bloqueia entradas indisponíveis. O servidor mantém sua própria autorização sobre dados e comandos.

## Código

- [src/management-access-policy.ts](../../src/management-access-policy.ts)
- [src/management-arena-navigation.ts](../../src/management-arena-navigation.ts)
- [reference/staff-permissions.ts](../../reference/staff-permissions.ts)

## Verificação desta edição

Sete cenários verificam política de rotas e navegação. Eles não constituem uma auditoria da autorização de toda a API.
