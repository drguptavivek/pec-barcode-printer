module.exports = {
	apps: [
		{
			name: 'vcms',
			cwd: __dirname,
			script: 'scripts/start-production.mjs',
			interpreter: 'node',
			instances: 1,
			exec_mode: 'fork',
			watch: false,
			time: true,
			max_memory_restart: '512M',
			error_file: 'logs/pm2-error.log',
			out_file: 'logs/pm2-out.log',
			log_file: 'logs/pm2-combined.log',
			env: {
				NODE_ENV: 'production',
				PORT: '3000'
			}
		}
	]
};
