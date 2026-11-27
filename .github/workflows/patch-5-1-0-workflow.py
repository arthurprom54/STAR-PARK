#!/usr/bin/env python3
"""Endurece el instalador existente de STAR PARK 5.1.0 sin tocar archivos de aplicación."""
from pathlib import Path

TARGET = Path('.github/workflows/star-park-grande-atualizacao.yml')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count == 0 and new in source:
        return source
    if count != 1:
        raise SystemExit(f"ABORTADO: '{label}' debía aparecer una vez; apareció {count}. No se guardó el archivo.")
    return source.replace(old, new, 1)


def main() -> None:
    if not TARGET.is_file():
        raise SystemExit(f'No encontré {TARGET}. Ejecute este script en la raíz del repositorio.')
    original = TARGET.read_text(encoding='utf-8')
    updated = original

    # Corrige la marca HTML que hacía fallar una aserción del propio workflow.
    updated = replace_once(
        updated,
        '<button class="mini-action danger" data-sp-close-goal="${esc(g.id)}">ENCERRAR</button>',
        '<button type="button" class="mini-action danger" data-sp-close-goal="${esc(g.id)}">ENCERRAR</button>',
        'tipo explícito no botón Encerrar meta',
    )

    # Incluye la preferencia de cuenta opcional en el registro de candidatura.
    updated = replace_once(
        updated,
        'new_application = "status:\'AWAITING_WHATSAPP\',apiLookupStatus,trophiesAtApplication,applicationTrophiesCapturedAt,submittedAt:nowISO(),',
        'new_application = "status:\'AWAITING_WHATSAPP\',apiLookupStatus,trophiesAtApplication,applicationTrophiesCapturedAt,wantsMemberAccount:body.wantsMemberAccount===true,submittedAt:nowISO(),',
        'persistencia del interés opcional por cuenta',
    )

    # Inserta la modificación del handler del frontend en el patcher ya existente.
    app_anchor = '          # UI de login/primeiro acesso: username aceito, email opcional e senha de 6 caracteres.\n'
    app_injection = '''          app = replace_once(
              app,
              "const body=Object.fromEntries(new FormData(form));body.privacyAcknowledged=form.elements.privacyAcknowledged.checked;",
              "const body=Object.fromEntries(new FormData(form));body.privacyAcknowledged=form.elements.privacyAcknowledged.checked;body.wantsMemberAccount=form.elements.wantsMemberAccount?.checked===true;",
              'persistencia do interesse opcional em conta'
          )

'''
    updated = replace_once(updated, app_anchor, app_injection + app_anchor, 'ponto de integração do formulário de candidatura')

    # Coloca uma caixa opcional no formulário sem tornar o pedido obrigatório.
    html_anchor = '          # Atualiza o texto explicativo do recrutamento para refletir o novo processo.\n'
    html_injection = '''          index = replace_once(
              index,
              '<label class="consent-row"><input type="checkbox" name="privacyAcknowledged" required>',
              '<label class="full-field toggle-row"><span><b>Quero solicitar uma conta de membro após minha ativação (opcional)</b><small>Isso não cria uma conta agora. Depois que a administração confirmar sua entrada, você poderá solicitar o acesso.</small></span><input type="checkbox" name="wantsMemberAccount"></label><label class="consent-row"><input type="checkbox" name="privacyAcknowledged" required>',
              'checkbox opcional de conta no formulario'
          )

'''
    updated = replace_once(updated, html_anchor, html_injection + html_anchor, 'ponto de integração do formulário HTML')

    # Exibe aos administradores quem marcou que tem interesse na futura conta.
    queue_old = '''<small>#${esc(item.playerTag)} · ${esc(item.desiredBrawlerName || 'Brawler nao informado')} · Enviada: ${esc(date(item.submittedAt))}</small><span class="status-tag warn">AGUARDANDO WHATSAPP</span>'''
    queue_new = '''<small>#${esc(item.playerTag)} · ${esc(item.desiredBrawlerName || 'Brawler nao informado')} · Enviada: ${esc(date(item.submittedAt))}</small>${item.wantsMemberAccount ? '<span class="status-tag">INTERESSE EM CONTA DE MEMBRO</span>' : ''}<span class="status-tag warn">AGUARDANDO WHATSAPP</span>'''
    updated = replace_once(updated, queue_old, queue_new, 'sinalização de interesse na fila administrativa')

    # Converte contas MODERATOR antigas em ADMIN; OWNER permanece inalterado.
    legacy_block = '''          # Permite papel legado MODERATOR sem oferecer esse cargo para novos cadastros.
          server = replace_once(
              server,
              "if(req.method==='POST'&&url.pathname==='/api/admin/users'){checkCsrf(req);if(user?.role!=='OWNER')",
              "if(req.method==='POST'&&url.pathname==='/api/admin/users'){checkCsrf(req);if(user?.role!=='OWNER')",
              'preservacao da rota de contas administrativas'
          )
'''
    legacy_replacement = r'''          # Apenas MEMBER e ADMIN são papéis de operação; OWNER permanece exclusivo.
          server = replace_once(
              server,
              "const roles = new Set(['OWNER','ADMIN','MODERATOR','MEMBER']);",
              "const roles = new Set(['OWNER','ADMIN','MEMBER']);",
              'papéis permitidos após migração'
          )
          server = replace_once(
              server,
              "  if(OWNER_EMAIL&&OWNER_PASSWORD){",
              "  const legacyModerators=store.users.filter(u=>u.role==='MODERATOR');\n  if(legacyModerators.length){\n    await mutate(()=>{for(const account of store.users){if(account.role==='MODERATOR'){account.role='ADMIN';account.permissions=defaultPermissions('ADMIN');account.roleMigratedAt=nowISO();audit(null,'Papel legado convertido para ADMIN',account.name||account.email||account.id);}}});\n    console.info(`[STAR PARK] ${legacyModerators.length} conta(s) MODERATOR convertida(s) para ADMIN.`);\n  }\n  if(OWNER_EMAIL&&OWNER_PASSWORD){",
              'migração auditada de MODERATOR para ADMIN'
          )
'''
    updated = replace_once(updated, legacy_block, legacy_replacement, 'bloco de migração de papéis')

    # Verifica explicitamente o interesse opcional e a migração na suíte adicional do workflow.
    updated = replace_once(
        updated,
        "          assert.match(server,/username\\|\\|body\\.email/);\n          assert.match(html,/starparkAwaitingWhatsapp/);",
        "          assert.match(server,/username\\|\\|body\\.email/);\n          assert.match(server,/wantsMemberAccount:body\\.wantsMemberAccount===true/);\n          assert.match(server,/legacyModerators/);\n          assert.match(html,/name=\"wantsMemberAccount\"/);\n          assert.match(html,/starparkAwaitingWhatsapp/);",
        'testes da preferência opcional e migração de cargo',
    )

    # Reexecuções sem alterações não devem tentar reaplicar os mesmos marcadores.
    updated = replace_once(
        updated,
        "          package_data = json.loads(package_text)\n          if package_data.get('version') not in ('5.0.3', '5.1.0'):",
        "          package_data = json.loads(package_text)\n          if package_data.get('version') == '5.1.0':\n              print('STAR PARK 5.1.0 ja esta instalada; esta execucao seguira apenas para as validacoes.')\n              raise SystemExit(0)\n          if package_data.get('version') not in ('5.0.3', '5.1.0'):",
        'reexecução segura em 5.1.0',
    )

    # Evita conflito de branch em reexecuções e não oculta falhas ao criar a PR.
    updated = replace_once(
        updated,
        'BRANCH="star-park/grande-atualizacao-${GITHUB_RUN_NUMBER}"',
        'BRANCH="star-park/grande-atualizacao-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
        'nome de branch exclusivo',
    )
    updated = replace_once(
        updated,
        '        continue-on-error: true\n        run: |',
        '        run: |',
        'falha de PR deve aparecer nos checks',
    )

    # Só gravar depois que todos os pontos críticos estiverem presentes.
    for marker, label in [
        ('wantsMemberAccount:body.wantsMemberAccount===true', 'interesse opcional'),
        ('legacyModerators', 'migração de papel'),
        ('type="button" class="mini-action danger" data-sp-close-goal', 'botão de meta corrigido'),
        ('GITHUB_RUN_ID', 'nome de branch exclusivo'),
        ('npm test', 'testes automatizados'),
    ]:
        if marker not in updated:
            raise SystemExit(f'ABORTADO: validação interna ausente: {label}.')

    if updated == original:
        print('O instalador já contém todas estas correções. Nenhuma gravação necessária.')
        return
    TARGET.write_text(updated, encoding='utf-8', newline='\n')
    print('Instalador STAR PARK 5.1.0 atualizado. Execute-o em uma branch separada e revise a PR; nada foi publicado.')


if __name__ == '__main__':
    main()
