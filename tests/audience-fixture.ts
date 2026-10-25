import {
  audienceContextHash,
  canonicalHash,
  type AudienceContext,
} from "../packages/contracts/src/audience";
export function audienceFixture(): AudienceContext {
  const plan = (channel: "blog" | "social" | "youtube") => ({
    channel,
    objective: "Construir autoridade",
    audience: ["Leitores"],
    formats: ["editorial"],
    cadence: "Semanal",
    pillars: ["Educação"],
    disclosure: "Persona virtual",
    constraints: ["Revisão humana"],
    planStatus: "planned" as const,
    versionId: `plan-${channel}-1`,
  });
  const snapshot = {
    characterBible: {
      name: "Persona de contrato",
      bio: "Biografia aprovada na origem",
      originStory: "Origem editorial documentada",
      mission: "Informar",
      positioning: "Conteúdo responsável",
      centralPromise: "Clareza",
      values: ["Transparência"],
      tensions: ["Velocidade e precisão"],
    },
    physicalIdentityBible: {
      physicalDescription: "Representação virtual declarada",
      continuityAnchors: ["Avatar estável"],
      avatarReferenceAssetIds: [],
    },
    visualConsistencyProfile: {
      styleTokens: ["editorial"],
      visualPrompts: ["Identidade visual consistente"],
      negativePrompts: [],
      aiDisclosure: "Persona virtual",
    },
    editorialProfile: {
      voice: "Claro",
      vocabulary: ["educação"],
      recurringExpressions: [],
      audience: ["Leitores"],
      painPoints: ["Excesso de informação"],
      desires: ["Informação confiável"],
      fears: [],
      objections: [],
      editorialPillars: ["Educação"],
      priorityTopics: ["Tecnologia"],
      prohibitedTopics: ["Alegações sem fonte"],
      claims: [],
      guardrails: ["Não inventar fontes"],
      qualityCriteria: ["Fontes verificadas"],
      reviewCriteria: ["Revisão humana"],
    },
    channelPlans: {
      blog: plan("blog"),
      social: plan("social"),
      youtube: plan("youtube"),
    },
    potentialNiches: [],
    disclosurePolicy: {
      aiDisclosureRequired: true,
      affiliateDisclosureTemplate: "Link afiliado",
      sensitiveTopicsPolicy: "Revisão especializada",
    },
  };
  const context: AudienceContext = {
    contractId: "dim.audience-context.v1",
    contractVersion: 1,
    source: "audience-builder",
    tenantId: "audience-tenant-a",
    projectId: "audience-project-a",
    contextVersion: 1,
    contextHash: "",
    personaPackage: {
      contractVersion: 1,
      personaId: "persona-a",
      personaVersionId: "persona-a-v1",
      personaVersion: 1,
      status: "approved",
      contentHash: canonicalHash(snapshot),
      approval: {
        approvalId: "approval-a-v1",
        approvedBy: "source-reviewer",
        approvedAt: "2026-01-01T12:00:00Z",
        approvalScope: "Persona e editorial",
        approvedVersions: ["persona-a-v1"],
      },
      snapshot,
      meta: { testOnly: false, authorityProjectId: "authority-a" },
    },
    authority: {
      version: 1,
      objectives: ["Construir autoridade no nicho"],
      editorialPillars: ["Educação"],
      milestones: [
        { id: "milestone-1", title: "Estruturar blog", status: "in_progress" },
      ],
    },
    blogs: [
      {
        id: "blog-a",
        name: "Blog da persona",
        version: 1,
        url: "https://blog.example.test",
        status: "draft",
        readbackVerified: false,
        receiptId: null,
      },
    ],
  };
  context.contextHash = audienceContextHash(context);
  return context;
}
