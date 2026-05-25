import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	return {
		user: locals.user ? { id: locals.user.id, username: locals.user.username, isGuest: locals.user.isGuest } : null,
		sessionExpired: url.searchParams.get('signed_out') === '1'
	};
};
