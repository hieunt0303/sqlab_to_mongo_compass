module.exports = {
  apps: [
    {
      name: "sqlab-to-mongo",
      script: "yarn",
      args: "start",
      // Use none interpreter to run yarn start directly as a shell process
      interpreter: "none",
      watch: false,
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      // Keep logs organized
      output: "./logs/out.log",
      error: "./logs/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    }
  ]
};
