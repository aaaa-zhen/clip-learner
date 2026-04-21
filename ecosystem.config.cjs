/**
 * PM2 config for Clip Learner (production).
 *
 * Requires Node 22.5+ on the VPS (needed for node:sqlite and --env-file).
 *
 * First-time setup on the VPS:
 *   cd /home/ubuntu/clip-learner
 *   cp .env.example .env.production      # then edit in your real keys
 *   npm ci
 *   npm run build
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 *
 * Deploy of subsequent changes:
 *   git pull && npm ci && npm run build && pm2 restart clip-learner
 */

module.exports = {
	apps: [
		{
			name: 'clip-learner',
			// Node reads .env.production automatically via --env-file, no dotenv
			// package required. Needs Node 20.6+ (22+ in practice since we also
			// need node:sqlite).
			script: 'build/index.js',
			node_args: '--env-file-if-exists=/home/ubuntu/clip-learner/.env.production',
			cwd: '/home/ubuntu/clip-learner',
			instances: 1,
			exec_mode: 'fork',
			max_memory_restart: '1G',
			env_production: {
				NODE_ENV: 'production',
				HOST: '127.0.0.1',
				PORT: '3000'
			},
			out_file: '/home/ubuntu/.pm2/logs/clip-learner-out.log',
			error_file: '/home/ubuntu/.pm2/logs/clip-learner-error.log',
			merge_logs: true,
			time: true
		}
	]
};
