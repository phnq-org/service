interface ServiceErrorOptions {
  type: 'unauthorized' | 'server-error' | 'bad-request' | 'anomaly';
  message?: string;
}

interface ServiceErrorPayload extends ServiceErrorOptions {
  ___service_error___: true;
}

class ServiceError extends Error {
  static fromError(err: unknown): ServiceError {
    if (err instanceof ServiceError) {
      return err;
    }
    return new ServiceError({
      type: 'server-error',
      message: (err as Error).message || String(err),
    });
  }

  static fromPayload(payload: unknown): ServiceError | undefined {
    if ((payload as ServiceErrorPayload).___service_error___) {
      return new ServiceError(payload as ServiceErrorOptions);
    }
  }

  private options: ServiceErrorOptions;

  public constructor(options: ServiceErrorOptions) {
    super(options.message ?? `Service error: ${options.type}`);
    this.options = options;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }

  get type(): ServiceErrorOptions['type'] {
    return this.options.type;
  }

  get payload(): ServiceErrorPayload {
    return { ...this.options, ___service_error___: true };
  }
}

export default ServiceError;
