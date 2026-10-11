const report = [
    '__sftp_plus_cwd_report() {',
    '  if [ -n "${STY-}" ] || [ "${TERM#screen}" != "$TERM" ]; then',
    '    printf \'\\033P\\033]1337;CurrentDir=%s\\007\\033\\\\\' "$PWD";',
    '  else',
    '    printf \'\\033]1337;CurrentDir=%s\\007\' "$PWD";',
    '  fi',
    '}',
].join('\n');
const hook = [
    'if [ -n "${BASH_VERSION-}" ]; then',
    '  case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in',
    '    "declare -a"*)',
    '      case " ${PROMPT_COMMAND[*]} " in *" __sftp_plus_cwd_report "*) ;; *) PROMPT_COMMAND+=(__sftp_plus_cwd_report);; esac;;',
    '    *)',
    '      case ";${PROMPT_COMMAND-};" in *"__sftp_plus_cwd_report"*) ;; *) PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND}; }__sftp_plus_cwd_report";; esac;;',
    '  esac',
    'elif [ -n "${ZSH_VERSION-}" ]; then',
    '  typeset -ga precmd_functions;',
    '  case " ${precmd_functions[*]} " in *" __sftp_plus_cwd_report "*) ;; *) precmd_functions+=(__sftp_plus_cwd_report);; esac',
    'fi',
    '__sftp_plus_cwd_report',
].join('\n');
const snippet = '# tabby-sftp-plus screen cwd reporting v2\n' + report + '\n' + hook + '\n';
// Each line already has its required shell delimiter. This keeps terminal setup to one submitted command.
const session = `eval "$(printf '%s' '${Buffer.from(report + '\n' + hook).toString('base64')}' | base64 -d)"`;

const permanent = [
    'set -eu',
    'HOOK="$HOME/.tabby-sftp-plus-cwd.sh"',
    'umask 077',
    'tmp=$(mktemp "$HOME/.tabby-sftp-plus-cwd.XXXXXX")',
    'trap \'rm -f "$tmp"\' EXIT',
    "printf '%s' '" + Buffer.from(snippet).toString('base64') + "' | base64 -d > \"$tmp\"",
    'grep -qF "__sftp_plus_cwd_report()" "$tmp"',
    'mv -f "$tmp" "$HOOK"',
    'install_rc() {',
    '  RC="$1"',
    '  if ! grep -qF "# tabby-sftp-plus cwd bootstrap v3" "$RC" 2>/dev/null; then',
    '    if [ -f "$RC" ] && [ ! -e "$RC.sftp-plus-screen-backup" ]; then cp -p "$RC" "$RC.sftp-plus-screen-backup"; fi',
    '    printf \'\n# tabby-sftp-plus cwd bootstrap v3\n[ -r "$HOME/.tabby-sftp-plus-cwd.sh" ] && . "$HOME/.tabby-sftp-plus-cwd.sh"\n\' >> "$RC"',
    '  fi',
    '  grep -qF \'[ -r "$HOME/.tabby-sftp-plus-cwd.sh" ] && . "$HOME/.tabby-sftp-plus-cwd.sh"\' "$RC"',
    '}',
    'case "$SHELL" in',
    '  *zsh) ZD=$(printenv ZDOTDIR || true); [ -n "$ZD" ] || ZD="$HOME"; RC="$ZD/.zshrc"; install_rc "$RC"; printf "SFTP_CWD_SAVED:%s\n" "$RC";;',
    '  *bash)',
    '    install_rc "$HOME/.bashrc"',
    '    if [ -f "$HOME/.bash_profile" ]; then LOGIN="$HOME/.bash_profile"; elif [ -f "$HOME/.bash_login" ]; then LOGIN="$HOME/.bash_login"; elif [ -f "$HOME/.profile" ]; then LOGIN="$HOME/.profile"; else LOGIN="$HOME/.bash_profile"; fi',
    '    install_rc "$LOGIN"',
    '    printf "SFTP_CWD_SAVED:%s + %s\n" "$HOME/.bashrc" "$LOGIN";;',
    '  *) printf "Unsupported shell: %s\n" "$SHELL"; exit 1;;',
    'esac',
].join('\n');
module.exports = { report, hook, snippet, session, permanent };
