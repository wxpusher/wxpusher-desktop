import log from 'electron-log';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// 日志文件大小上限 50MB
log.transports.file.maxSize = 50 * 1024 * 1024;

export const logger = log;
