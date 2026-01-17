import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  
  transport: isProduction
    ? undefined // JSON in Production
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
  
  base: {
    service: 'mds',
    version: process.env.npm_package_version || '1.0.0',
  },
})

// Request logger for API routes
export function logRequest(method: string, url: string, context?: string) {
  logger.info({
    method,
    url,
    context,
  }, 'API Request')
}

// Error logger
export function logError(error: Error, context?: string) {
  logger.error({
    error: error.message,
    stack: error.stack,
    context,
  }, 'Error occurred')
}

export default logger
