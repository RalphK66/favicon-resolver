import { defineHandler } from 'void'

export const GET = defineHandler(c =>
  c.text(
    'favicon-resolver\n\nGET /<hostname>  e.g. /github.com or /https://github.com/user/repo\n' +
      'Optional ?size=16|32|64|128|256 (preferred side in px, default 64).\n\n404 means no icon was found.\n'
  )
)
