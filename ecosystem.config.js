module.exports = {
  apps: [
    {
      name: "worker",
      cwd: "/competitors/competitor-analysis",
      script: "./node_modules/.bin/tsx",
      args: "worker/index.ts",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: { NODE_ENV: "production" }
    }
  ]
};
