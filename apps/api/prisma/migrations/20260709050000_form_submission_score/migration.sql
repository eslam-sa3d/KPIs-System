-- AlterTable: quiz-mode scoring, computed once at submit time
ALTER TABLE "FormSubmission" ADD COLUMN "score" JSONB;
