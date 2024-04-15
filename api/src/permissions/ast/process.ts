import type { PermissionsAction } from '@directus/system-data';
import type { Accountability, SchemaOverview } from '@directus/types';
import { getDatabase } from '../../database/index.js';
import { AccessService } from '../../services/access.js';
import { PoliciesService } from '../../services/policies.js';
import { RolesService } from '../../services/roles.js';
import type { AST } from '../../types/ast.js';
import { ipInNetworks } from '../../utils/ip-in-networks.js';
import { fieldMapFromAst } from './lib/field-map-from-ast.js';
import type { FieldMap } from './types.js';
import { collectionsInFieldMap } from './utils/collections-in-field-map.js';
import { fetchRolesTree } from './utils/fetch-roles-tree.js';

interface AccessRow {
	policy: { id: string; admin_access: boolean; ip_access: string };
	sort: number;
	role: null | string;
	user: null | string;
}

export async function process(
	ast: AST,
	action: PermissionsAction,
	accountability: Accountability,
	schema: SchemaOverview,
) {
	const knex = getDatabase();

	const rolesService = new RolesService({ schema, knex });
	const policiesService = new PoliciesService({ schema, knex });
	const accessService = new AccessService({ schema, knex });

	const isPublic = accountability.role === null;

	let policies: AccessRow[] = [];

	// If the current accountability indicates that the request is made using the public role, we can
	// ignore the user policies (as there's no users in the "public" role)
	if (isPublic) {
		policies = (await accessService.readByQuery({
			fields: ['policy.id', 'policy.admin_access', 'policy.ip_access', 'sort', 'role'],
			sort: ['sort'],
			filter: { role: { _null: true } },
		})) as AccessRow[];
	} else {
		const roles = await fetchRolesTree(rolesService, accountability.role!);

		const roleFilter = { role: { _in: roles } };

		const filter = accountability.user ? { _or: [{ user: { _eq: accountability.user } }, roleFilter] } : roleFilter;

		policies = (await accessService.readByQuery({
			fields: ['policy', 'sort', 'role'],
			sort: ['role', 'sort'],
			filter,
		})) as AccessRow[];
	}

	const isAdmin = policies.some(({ policy }) => policy.admin_access);

	if (isAdmin) {
		// TODO still validate against fields to make sure they exist?
		return;
	}

	policies = policies.filter(({ policy }) => {
		const ipAllowList = policy.ip_access?.split(',') ?? null;

		// Keep policies that don't have an ip address allow list configured
		if (!ipAllowList) {
			return true;
		}

		// If the client's IP address is unknown, we can't validate it against the allow list and will
		// have to default to the more secure option of preventing access
		if (!accountability.ip) {
			return false;
		}

		return ipInNetworks(accountability.ip, ipAllowList);
	});

	const rolePolicies = policies.filter(({ user }) => user === null);
	const userPolicies = policies.filter(({ user }) => user !== null);

	// The order of all policies should be:
	// - Role, sorted by tree (eg grandparent -> parent -> current), followed by `sort`
	// - User, sorted by `sort`

	let policies = [];

	const policyIds = policies.map(({ policy }) => policy.id);

	// Fetch permissions nested with policies by collection+action

	// Validate fieldMap against fetched permissions

	const fieldMap: FieldMap = fieldMapFromAst(ast, schema);
	const collections = collectionsInFieldMap(fieldMap);

	// Inject read access filter rules in ast

	// return, ?, profit
}