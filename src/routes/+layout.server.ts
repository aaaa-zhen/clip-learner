import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	return {
		user: locals.user,
		sessionExpired: url.searchParams.get('signed_out') === '1'
	};
};
