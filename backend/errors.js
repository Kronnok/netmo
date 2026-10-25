<<<<<<< HEAD
class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

module.exports = { AppError };
=======
class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

module.exports = { AppError };
>>>>>>> 219c483 (Publish deployment cleanup with sanitized credentials)
