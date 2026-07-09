import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';

/**
 * Demo/sandbox data for test-driving every feature: dashboards, forms,
 * users, roles, and KPIs. Every record is tagged by a naming marker so
 * removal is surgical:
 *   users → *@pulse.demo   roles/departments → "Demo …"
 *   KPIs  → name "Demo: …"   forms           → slug demo-*
 */

export const DEMO_PASSWORD = 'DemoPass!2026';
const DEMO_EMAIL_DOMAIN = '@pulse.demo';
const DEMO_KPI_PREFIX = 'Demo: ';

const DEMO_USERS = [
  { email: `demo.analyst${DEMO_EMAIL_DOMAIN}`, displayName: 'Demo Analyst', dept: 'Demo Delivery' },
  { email: `demo.lead${DEMO_EMAIL_DOMAIN}`, displayName: 'Demo Delivery Lead', dept: 'Demo Delivery' },
  { email: `demo.ops${DEMO_EMAIL_DOMAIN}`, displayName: 'Demo Ops Manager', dept: 'Demo Operations' },
];

/** Each KPI is just a name; its Evaluation Areas carry the actual 0-5 scoring,
 *  mirroring the QA evaluation surveys this system is modeled on. */
const DEMO_KPIS = [
  {
    name: `${DEMO_KPI_PREFIX}QA Lead Evaluation`,
    areas: [
      { name: 'Leadership & People Management', cadence: 'quarterly' },
      { name: 'Project & Delivery Management', cadence: 'quarterly' },
      { name: 'Quality Assurance Leadership', cadence: 'quarterly' },
    ],
  },
  {
    name: `${DEMO_KPI_PREFIX}Delivery Performance`,
    areas: [
      { name: 'Sprint Velocity', cadence: 'weekly' },
      { name: 'Customer Satisfaction', cadence: 'monthly' },
    ],
  },
] as const;

const DEMO_FORM_DEFINITION = {
  title: 'demo sprint health check',
  description: 'sample form seeded by the demo data generator',
  fields: [
    { key: 'team', label: 'Team', type: 'short_text', required: true, maxLength: 200 },
    { key: 'velocity', label: 'Velocity (points)', type: 'number', required: true, min: 0, max: 200, integerOnly: true },
    { key: 'blocked', label: 'Any blockers?', type: 'boolean', required: true },
    {
      key: 'blocker_detail',
      label: 'Blocker details',
      type: 'long_text',
      required: true,
      maxLength: 2000,
      visibleWhen: { fieldKey: 'blocked', equals: true },
    },
    { key: 'confidence', label: 'Delivery confidence', type: 'rating', required: false, scale: 5 },
    {
      key: 'stream',
      label: 'Delivery stream',
      type: 'select',
      required: true,
      options: [
        { value: 'digital', label: 'digital' },
        { value: 'infrastructure', label: 'infrastructure' },
        { value: 'data', label: 'data' },
      ],
    },
  ],
};

const DEMO_TEAMS = ['falcons', 'nomads', 'atlas', 'horizon'];
const DEMO_STREAMS = ['digital', 'infrastructure', 'data'];

@Injectable()
export class DemoDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  async status() {
    const [users, kpis, forms, roles, departments, submissions] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } }),
      this.prisma.kpi.count({ where: { name: { startsWith: DEMO_KPI_PREFIX } } }),
      this.prisma.form.count({ where: { slug: { startsWith: 'demo-' } } }),
      this.prisma.role.count({ where: { name: { startsWith: 'Demo ' } } }),
      this.prisma.department.count({ where: { name: { startsWith: 'Demo ' } } }),
      this.prisma.formSubmission.count({
        where: { formVersion: { form: { slug: { startsWith: 'demo-' } } } },
      }),
    ]);
    return {
      present: users + kpis + forms > 0,
      counts: { users, kpis, forms, roles, departments, submissions },
      demoPassword: DEMO_PASSWORD,
      demoUsers: DEMO_USERS.map((u) => u.email),
    };
  }

  async seed(actorId: string) {
    if ((await this.status()).present) {
      throw new AppError('CONFLICT', 'Demo data already exists — remove it before re-seeding');
    }

    // departments
    const deptByName = new Map<string, string>();
    for (const name of ['Demo Delivery', 'Demo Operations']) {
      const dept = await this.prisma.department.create({ data: { name } });
      deptByName.set(name, dept.id);
    }

    // role with a realistic non-admin permission slice
    const analystGrants = [
      ['kpis', 'read'],
      ['kpi_entries', 'read'],
      ['kpi_entries', 'write'],
      ['dashboards', 'read'],
      ['forms', 'read'],
      ['form_submissions', 'read'],
      ['form_submissions', 'write'],
    ];
    const role = await this.prisma.role.create({
      data: { name: 'Demo Analyst', description: 'Seeded role for exploring role-scoped views' },
    });
    for (const [resource, action] of analystGrants) {
      const permission = await this.prisma.permission.upsert({
        where: { resource_action: { resource: resource!, action: action! } },
        create: { resource: resource!, action: action! },
        update: {},
      });
      await this.prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }

    // users (all share DEMO_PASSWORD so any of them can be test-driven)
    const passwordHash = await this.hasher.hash(DEMO_PASSWORD);
    const userIds: string[] = [];
    for (const spec of DEMO_USERS) {
      const user = await this.prisma.user.create({
        data: {
          email: spec.email,
          displayName: spec.displayName,
          passwordHash,
          departmentId: deptByName.get(spec.dept),
          roles: { create: [{ roleId: role.id }] },
        },
      });
      userIds.push(user.id);
    }

    // KPIs mapped to the demo role, demo departments, AND the admin role so
    // the admin's own dashboard lights up immediately
    const adminRole = await this.prisma.role.findUnique({ where: { name: 'admin' } });
    const stepDaysByCadence: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };
    for (const [index, spec] of DEMO_KPIS.entries()) {
      const kpi = await this.prisma.kpi.create({ data: { name: spec.name } });
      await this.prisma.kpiAssignment.createMany({
        data: [
          { kpiId: kpi.id, roleId: role.id },
          ...(adminRole ? [{ kpiId: kpi.id, roleId: adminRole.id }] : []),
          {
            kpiId: kpi.id,
            departmentId: deptByName.get(index % 2 === 0 ? 'Demo Delivery' : 'Demo Operations'),
            deliveryStream: DEMO_STREAMS[index % DEMO_STREAMS.length],
          },
        ],
      });

      // each Evaluation Area gets 12 periods of history for one demo evaluatee,
      // trending upward toward "outstanding" so the status bands are all visible
      for (const [areaIndex, areaSpec] of spec.areas.entries()) {
        const area = await this.prisma.evaluationArea.create({
          data: { kpiId: kpi.id, name: areaSpec.name, cadence: areaSpec.cadence },
        });
        const stepDays = stepDaysByCadence[areaSpec.cadence] ?? 30;
        const personId = userIds[(index + areaIndex) % userIds.length]!;
        for (let period = 0; period < 12; period++) {
          const end = new Date(Date.now() - period * stepDays * 24 * 60 * 60 * 1000);
          const start = new Date(end.getTime() - stepDays * 24 * 60 * 60 * 1000);
          const progress = (11 - period) / 11; // older → newer trends upward
          const jitter = (Math.random() - 0.5) * 0.4;
          const value = Math.min(5, Math.max(0, Math.round((2.5 + progress * 2 + jitter) * 10) / 10));
          await this.prisma.evaluationAreaEntry.create({
            data: {
              evaluationAreaId: area.id,
              personId,
              value,
              periodStart: start,
              periodEnd: end,
              enteredById: userIds[(period + 1) % userIds.length]!,
              note: period === 0 ? 'latest demo period' : null,
            },
          });
        }
      }
    }

    // form + submissions
    const form = await this.prisma.form.create({
      data: {
        slug: 'demo-sprint-health',
        status: 'published',
        createdById: actorId,
        versions: { create: { version: 1, definition: DEMO_FORM_DEFINITION } },
      },
      include: { versions: true },
    });
    const versionId = form.versions[0]!.id;
    for (let i = 0; i < 10; i++) {
      const blocked = i % 3 === 0;
      await this.prisma.formSubmission.create({
        data: {
          formVersionId: versionId,
          submittedById: userIds[i % userIds.length]!,
          createdAt: new Date(Date.now() - i * 36 * 60 * 60 * 1000),
          answers: {
            team: DEMO_TEAMS[i % DEMO_TEAMS.length]!,
            velocity: 30 + Math.round(Math.random() * 25),
            blocked,
            ...(blocked ? { blocker_detail: 'waiting on environment access (demo)' } : {}),
            confidence: 3 + (i % 3),
            stream: DEMO_STREAMS[i % DEMO_STREAMS.length]!,
          },
        },
      });
    }

    await this.prisma.auditLog.create({
      data: { actorId, action: 'settings.demo_data_seeded', entity: 'DemoData' },
    });
    return this.status();
  }

  /** Order matters: dependents before principals, markers only — real data untouched. */
  async remove(actorId: string) {
    await this.prisma.formSubmission.deleteMany({
      where: {
        OR: [
          { formVersion: { form: { slug: { startsWith: 'demo-' } } } },
          { submittedBy: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
        ],
      },
    });
    await this.prisma.form.deleteMany({ where: { slug: { startsWith: 'demo-' } } });
    await this.prisma.evaluationAreaEntry.deleteMany({
      where: {
        OR: [
          { evaluationArea: { kpi: { name: { startsWith: DEMO_KPI_PREFIX } } } },
          { person: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
          { enteredBy: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
        ],
      },
    });
    await this.prisma.kpi.deleteMany({ where: { name: { startsWith: DEMO_KPI_PREFIX } } });
    await this.prisma.user.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } });
    await this.prisma.role.deleteMany({ where: { name: { startsWith: 'Demo ' }, isSystem: false } });
    // detach any real users an admin may have moved into a demo department
    await this.prisma.user.updateMany({
      where: { department: { name: { startsWith: 'Demo ' } } },
      data: { departmentId: null },
    });
    await this.prisma.department.deleteMany({ where: { name: { startsWith: 'Demo ' } } });

    await this.prisma.auditLog.create({
      data: { actorId, action: 'settings.demo_data_removed', entity: 'DemoData' },
    });
    return this.status();
  }
}
