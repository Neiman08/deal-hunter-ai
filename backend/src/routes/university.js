const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { incrementMission, logTransaction } = require('../services/businessActions');
const logger = require('../utils/logger');

// ── Helper: generate certificate code ─────────────────────────────────────────
function genCertCode(userId, courseSlug) {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  const ts   = Date.now().toString(36).toUpperCase();
  return `DHU-${rand}-${ts}`.slice(0, 40);
}

// ── GET /api/university/courses ───────────────────────────────────────────────
// Public if no auth token; includes progress if authenticated
router.get('/courses', async (req, res) => {
  try {
    // Try to get authenticated user (optional)
    let uid = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        uid = payload.id || payload.userId || payload.sub;
      } catch (_) { /* no auth — public mode */ }
    }

    const coursesRes = await query(`
      SELECT id, slug, title, description, category, level_required, xp_reward, badge_reward, order_index
      FROM university_courses
      WHERE is_active = true
      ORDER BY order_index ASC
    `);

    const courses = coursesRes.rows;

    // Count lessons per course
    const lessonCountRes = await query(`
      SELECT course_id, COUNT(*) AS total
      FROM university_lessons WHERE is_active = true
      GROUP BY course_id
    `);
    const lessonCounts = {};
    for (const r of lessonCountRes.rows) lessonCounts[r.course_id] = parseInt(r.total);

    if (uid) {
      // Progress per course
      const progRes = await query(`
        SELECT course_id, COUNT(*) AS completed_lessons
        FROM university_progress
        WHERE user_id = $1
        GROUP BY course_id
      `, [uid]);
      const progMap = {};
      for (const r of progRes.rows) progMap[r.course_id] = parseInt(r.completed_lessons);

      // Certificates
      const certRes = await query(
        `SELECT course_id FROM university_certificates WHERE user_id=$1`,
        [uid]
      );
      const certSet = new Set(certRes.rows.map(r => r.course_id));

      return res.json({
        courses: courses.map(c => {
          const total     = lessonCounts[c.id] || 0;
          const completed = progMap[c.id] || 0;
          const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
          return {
            ...c,
            total_lessons:     total,
            completed_lessons: completed,
            progress_percent:  pct,
            is_completed:      total > 0 && completed >= total,
            has_certificate:   certSet.has(c.id),
          };
        }),
      });
    }

    res.json({
      courses: courses.map(c => ({
        ...c,
        total_lessons:     lessonCounts[c.id] || 0,
        completed_lessons: 0,
        progress_percent:  0,
        is_completed:      false,
        has_certificate:   false,
      })),
    });
  } catch (err) {
    logger.error(`[University] GET /courses: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/university/courses/:slug ─────────────────────────────────────────
router.get('/courses/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    // Try optional auth
    let uid = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        uid = payload.id || payload.userId || payload.sub;
      } catch (_) {}
    }

    const courseRes = await query(
      `SELECT * FROM university_courses WHERE slug=$1 AND is_active=true`,
      [slug]
    );
    if (!courseRes.rows[0]) return res.status(404).json({ error: 'Course not found' });
    const course = courseRes.rows[0];

    const lessonsRes = await query(`
      SELECT id, slug, title, content, video_url, duration_minutes, order_index
      FROM university_lessons
      WHERE course_id=$1 AND is_active=true
      ORDER BY order_index ASC
    `, [course.id]);

    let completedSet = new Set();
    let hasCert = false;

    if (uid) {
      const progRes = await query(
        `SELECT lesson_id FROM university_progress WHERE user_id=$1 AND course_id=$2`,
        [uid, course.id]
      );
      completedSet = new Set(progRes.rows.map(r => r.lesson_id));

      const certRes = await query(
        `SELECT certificate_code, issued_at FROM university_certificates WHERE user_id=$1 AND course_id=$2`,
        [uid, course.id]
      );
      hasCert = !!certRes.rows[0];
    }

    const lessons = lessonsRes.rows.map(l => ({
      ...l,
      is_completed: completedSet.has(l.id),
    }));

    const totalLessons     = lessons.length;
    const completedLessons = lessons.filter(l => l.is_completed).length;
    const progressPercent  = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    res.json({
      course: {
        ...course,
        total_lessons:     totalLessons,
        completed_lessons: completedLessons,
        progress_percent:  progressPercent,
        is_completed:      totalLessons > 0 && completedLessons >= totalLessons,
        has_certificate:   hasCert,
      },
      lessons,
    });
  } catch (err) {
    logger.error(`[University] GET /courses/:slug: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/university/lessons/:id/complete ─────────────────────────────────
router.post('/lessons/:id/complete', authenticate, async (req, res) => {
  try {
    const lessonId = req.params.id;
    const uid      = req.user.id;

    // Verify lesson exists
    const lessonRes = await query(`
      SELECT l.id, l.course_id, l.title, c.slug AS course_slug, c.title AS course_title,
             c.xp_reward, c.badge_reward, c.id AS cid
      FROM university_lessons l
      JOIN university_courses c ON c.id = l.course_id
      WHERE l.id = $1 AND l.is_active = true AND c.is_active = true
    `, [lessonId]);

    if (!lessonRes.rows[0]) return res.status(404).json({ error: 'Lesson not found' });
    const lesson = lessonRes.rows[0];

    // Upsert progress
    await query(`
      INSERT INTO university_progress (user_id, course_id, lesson_id, status, completed_at)
      VALUES ($1, $2, $3, 'completed', NOW())
      ON CONFLICT (user_id, lesson_id) DO UPDATE
        SET status='completed', completed_at=COALESCE(university_progress.completed_at, NOW()), updated_at=NOW()
    `, [uid, lesson.course_id, lessonId]);

    // Increment mission (fire-and-forget style, but we await here since we need course completion check)
    incrementMission(uid, 'complete_lesson').catch(() => {});

    // Check if course is now complete
    const allLessonsRes = await query(
      `SELECT COUNT(*) AS total FROM university_lessons WHERE course_id=$1 AND is_active=true`,
      [lesson.course_id]
    );
    const completedRes = await query(
      `SELECT COUNT(*) AS done FROM university_progress WHERE user_id=$1 AND course_id=$2 AND status='completed'`,
      [uid, lesson.course_id]
    );

    const totalLessons     = parseInt(allLessonsRes.rows[0].total);
    const completedLessons = parseInt(completedRes.rows[0].done);
    const courseCompleted  = completedLessons >= totalLessons;
    let certificateCode    = null;
    let xpAwarded          = 0;

    if (courseCompleted) {
      // Check if already awarded
      const existCert = await query(
        `SELECT id FROM university_certificates WHERE user_id=$1 AND course_id=$2`,
        [uid, lesson.course_id]
      );

      if (!existCert.rows[0]) {
        // Issue certificate
        certificateCode = genCertCode(uid, lesson.course_slug);
        await query(`
          INSERT INTO university_certificates (user_id, course_id, certificate_code, metadata)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, course_id) DO NOTHING
        `, [uid, lesson.course_id, certificateCode,
            JSON.stringify({ course_title: lesson.course_title, completed_at: new Date().toISOString() })]);

        // Award XP
        xpAwarded = lesson.xp_reward || 0;
        if (xpAwarded > 0) {
          await query(`
            UPDATE collaborator_profiles
            SET points = points + $1, xp_this_month = xp_this_month + $1, updated_at=NOW()
            WHERE user_id = $2
          `, [xpAwarded, uid]);

          await query(`
            INSERT INTO contributor_wallets (user_id, lifetime_points)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE
              SET lifetime_points = contributor_wallets.lifetime_points + $2, updated_at=NOW()
          `, [uid, xpAwarded]);

          logTransaction(uid, 'course_completed', {
            xp: xpAwarded,
            status: 'approved',
            refType: 'university_course',
            refId: lesson.course_id,
            description: `Course completed: ${lesson.course_title} (+${xpAwarded} XP)`,
          }).catch(() => {});
        }

        // Badge reward
        if (lesson.badge_reward) {
          await query(`
            INSERT INTO hunter_badges (user_id, badge_slug, badge_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, badge_slug) DO NOTHING
          `, [uid, lesson.badge_reward, lesson.badge_reward.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]);
        }

        // Increment course mission
        incrementMission(uid, 'complete_course').catch(() => {});

        logger.info(`[University] course complete uid=${uid} course=${lesson.course_slug} xp=+${xpAwarded}`);
      }
    }

    res.json({
      completed: true,
      lesson_id: lessonId,
      course_completed: courseCompleted,
      certificate_code: certificateCode,
      xp_awarded: xpAwarded,
      progress: {
        completed_lessons: completedLessons,
        total_lessons:     totalLessons,
        progress_percent:  Math.round((completedLessons / totalLessons) * 100),
      },
    });
  } catch (err) {
    logger.error(`[University] POST /lessons/:id/complete: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/university/certificates ─────────────────────────────────────────
router.get('/certificates', authenticate, async (req, res) => {
  try {
    const uid = req.user.id;
    const certsRes = await query(`
      SELECT uc.certificate_code, uc.issued_at, uc.metadata,
             c.slug, c.title, c.category, c.xp_reward
      FROM university_certificates uc
      JOIN university_courses c ON c.id = uc.course_id
      WHERE uc.user_id = $1
      ORDER BY uc.issued_at DESC
    `, [uid]);
    res.json({ certificates: certsRes.rows });
  } catch (err) {
    logger.error(`[University] GET /certificates: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
