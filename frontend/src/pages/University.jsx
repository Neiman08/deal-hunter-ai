import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GraduationCap, BookOpen, CheckCircle, Clock, Zap, Award,
  ChevronRight, ChevronLeft, ArrowLeft, AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';

const CATEGORY_META = {
  platform:   { label: 'Platform',       color: '#4ADE80' },
  tools:      { label: 'Tools',          color: '#60A5FA' },
  strategy:   { label: 'Strategy',       color: '#FBBF24' },
  reselling:  { label: 'Reselling',      color: '#C084FC' },
  community:  { label: 'Community',      color: '#F97316' },
  growth:     { label: 'Growth',         color: '#F43F5E' },
  leadership: { label: 'Leadership',     color: '#A78BFA' },
};

function CourseCard({ course, onClick }) {
  const { t } = useTranslation();
  const cat   = CATEGORY_META[course.category] || { label: course.category, color: '#94A3B8' };
  const pct   = course.progress_percent || 0;
  const done  = course.is_completed;

  return (
    <button onClick={onClick}
      className="w-full text-left rounded-2xl p-4 border transition-all group bg-dark-800/60 hover:border-neon-green/30"
      style={{ borderColor: done ? `${cat.color}40` : undefined }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
          style={{ background: `${cat.color}15`, border: `1px solid ${cat.color}25` }}>
          {done ? '🎓' : '📚'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${cat.color}18`, color: cat.color }}>
              {cat.label}
            </span>
            {done && (
              <span className="text-[10px] text-neon-green flex items-center gap-0.5">
                <CheckCircle size={9} /> {t('university.completed', 'Done')}
              </span>
            )}
            {course.has_certificate && (
              <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
                <Award size={9} /> {t('university.certificates', 'Cert')}
              </span>
            )}
          </div>
          <p className="text-white text-sm font-semibold leading-snug">{course.title}</p>
          <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{course.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <BookOpen size={10} /> {course.total_lessons} {t('university.lessons', 'lessons')}
            </span>
            <span className="flex items-center gap-1 text-neon-green font-semibold">
              <Zap size={10} /> +{course.xp_reward} XP
            </span>
          </div>
        </div>
        <ChevronRight size={14} className="text-gray-600 group-hover:text-neon-green flex-shrink-0 mt-1 transition-colors" />
      </div>
      {pct > 0 && pct < 100 && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-dark-700">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cat.color }} />
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">{pct}% {t('university.complete_pct', 'complete')}</p>
        </div>
      )}
    </button>
  );
}

function LessonView({ course, lessons, onBack, onComplete }) {
  const { t } = useTranslation();
  const [activeIdx, setActiveIdx]     = useState(() => {
    const firstIncomplete = lessons.findIndex(l => !l.is_completed);
    return firstIncomplete >= 0 ? firstIncomplete : 0;
  });
  const [completing, setCompleting]   = useState(false);
  const [justDone, setJustDone]       = useState(new Set());

  const lesson = lessons[activeIdx];
  if (!lesson) return null;

  async function markComplete() {
    if (justDone.has(lesson.id) || lesson.is_completed) return;
    setCompleting(true);
    try {
      const res = await api.post(`/university/lessons/${lesson.id}/complete`);
      const { xp_awarded, course_completed, certificate_code } = res.data;
      setJustDone(prev => new Set([...prev, lesson.id]));
      onComplete({ lessonId: lesson.id, xpAwarded: xp_awarded, courseCompleted: course_completed, certCode: certificate_code });
    } catch (_) {}
    setCompleting(false);
  }

  const isMarkedDone = lesson.is_completed || justDone.has(lesson.id);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-gray-400 text-xs">{course.title}</p>
          <h2 className="text-white font-bold text-sm truncate">{lesson.title}</h2>
        </div>
        <span className="text-gray-500 text-xs flex-shrink-0">
          {activeIdx + 1} / {lessons.length}
        </span>
      </div>

      {/* Lesson nav pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {lessons.map((l, i) => {
          const done = l.is_completed || justDone.has(l.id);
          return (
            <button key={l.id} onClick={() => setActiveIdx(i)}
              className="flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold transition-all"
              style={{
                background: i === activeIdx ? '#4ADE80' : done ? '#4ADE8030' : '#1F2937',
                color:      i === activeIdx ? '#0A0A0A'  : done ? '#4ADE80'   : '#6B7280',
              }}>
              {done ? '✓' : i + 1}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="rounded-2xl bg-dark-800/60 border border-dark-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={12} className="text-gray-500" />
          <span className="text-gray-500 text-xs">{lesson.duration_minutes} min</span>
          {isMarkedDone && (
            <span className="ml-auto text-neon-green text-xs flex items-center gap-1">
              <CheckCircle size={11} /> {t('university.completed', 'Completed')}
            </span>
          )}
        </div>
        <div className="prose prose-invert prose-sm max-w-none">
          {lesson.content?.split('\n').map((line, i) => {
            if (!line.trim()) return <br key={i} />;
            if (line.startsWith('**') && line.endsWith('**')) {
              return <p key={i} className="font-bold text-white text-sm">{line.slice(2, -2)}</p>;
            }
            if (line.startsWith('# ')) {
              return <h3 key={i} className="text-white font-black text-base mt-3">{line.slice(2)}</h3>;
            }
            return (
              <p key={i} className="text-gray-300 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: line
                    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
                    .replace(/✅|⚠️|❌/g, m => `<span>${m}</span>`)
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {activeIdx > 0 && (
          <button onClick={() => setActiveIdx(i => i - 1)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-dark-700 text-gray-300 text-sm hover:bg-dark-600 transition-colors">
            <ChevronLeft size={14} /> {t('university.prev', 'Prev')}
          </button>
        )}

        {!isMarkedDone ? (
          <button onClick={markComplete} disabled={completing}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: '#4ADE80', color: '#0A0A0A' }}>
            {completing
              ? <span className="w-4 h-4 border-2 border-dark-900 border-t-transparent rounded-full animate-spin" />
              : <><CheckCircle size={15} /> {t('university.mark_complete', 'Mark Complete')}</>
            }
          </button>
        ) : (
          <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-neon-green/10 border border-neon-green/20"
            style={{ color: '#4ADE80' }}>
            <CheckCircle size={15} /> {t('university.completed', 'Completed')}
          </div>
        )}

        {activeIdx < lessons.length - 1 && (
          <button onClick={() => setActiveIdx(i => i + 1)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-dark-700 text-gray-300 text-sm hover:bg-dark-600 transition-colors">
            {t('university.next', 'Next')} <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function University() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [courses, setCourses]           = useState([]);
  const [selectedCourse, setSelected]   = useState(null); // { course, lessons }
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [courseLoading, setCourseLoad]  = useState(false);
  const [toast, setToast]               = useState(null); // { msg, xp }
  const [certs, setCerts]               = useState([]);

  useEffect(() => {
    Promise.all([
      api.get('/university/courses'),
      api.get('/university/certificates'),
    ])
      .then(([cRes, certRes]) => {
        setCourses(cRes.data.courses || []);
        setCerts(certRes.data.certificates || []);
      })
      .catch(err => {
        if (err.response?.status === 401) navigate('/login');
        else setError(t('university.load_error', 'Failed to load University.'));
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  async function openCourse(course) {
    setCourseLoad(true);
    try {
      const res = await api.get(`/university/courses/${course.slug}`);
      setSelected({ course: res.data.course, lessons: res.data.lessons });
    } catch (_) {}
    setCourseLoad(false);
  }

  function handleLessonComplete({ lessonId, xpAwarded, courseCompleted, certCode }) {
    // Update local lesson state
    setSelected(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lessons: prev.lessons.map(l => l.id === lessonId ? { ...l, is_completed: true } : l),
        course:  {
          ...prev.course,
          completed_lessons: (prev.course.completed_lessons || 0) + 1,
          is_completed: courseCompleted,
        },
      };
    });

    // Update course list
    setCourses(prev => prev.map(c =>
      c.slug === selectedCourse?.course?.slug
        ? { ...c, completed_lessons: (c.completed_lessons || 0) + 1, is_completed: courseCompleted, has_certificate: courseCompleted }
        : c
    ));

    if (xpAwarded > 0 || courseCompleted) {
      const msg = courseCompleted
        ? `🎓 Course complete! +${xpAwarded} XP earned${certCode ? ' · Certificate issued!' : ''}`
        : `+${xpAwarded} XP earned`;
      setToast({ msg });
      setTimeout(() => setToast(null), 4000);
    }
  }

  const completedCourses = courses.filter(c => c.is_completed).length;
  const inProgressCourses = courses.filter(c => !c.is_completed && c.completed_lessons > 0).length;
  const totalXpAvailable = courses.filter(c => !c.is_completed).reduce((s, c) => s + c.xp_reward, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle size={28} className="mx-auto text-yellow-400 mb-2" />
        <p className="text-gray-400 text-sm">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-3 text-sm px-5">{t('university.retry', 'Retry')}</button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-neon-green text-dark-900 px-4 py-2.5 rounded-xl font-bold text-sm shadow-lg animate-pulse">
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        {selectedCourse ? (
          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">
            <ArrowLeft size={18} />
          </button>
        ) : (
          <Link to="/business" className="text-gray-400 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
        )}
        <div>
          <div className="flex items-center gap-2">
            <GraduationCap size={20} className="text-neon-green" />
            <h1 className="text-xl font-black text-white">
              {selectedCourse ? selectedCourse.course.title : t('university.title', 'Deal Hunter University')}
            </h1>
          </div>
          {!selectedCourse && (
            <p className="text-gray-400 text-xs mt-0.5">
              {completedCourses}/{courses.length} courses completed · {totalXpAvailable} XP available
            </p>
          )}
        </div>
      </div>

      {/* Lesson view */}
      {selectedCourse ? (
        <LessonView
          course={selectedCourse.course}
          lessons={selectedCourse.lessons}
          onBack={() => setSelected(null)}
          onComplete={handleLessonComplete}
        />
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: t('university.completed',    'Completed'),    value: completedCourses,    color: '#4ADE80', icon: '🎓' },
              { label: t('university.in_progress',  'In Progress'),  value: inProgressCourses,   color: '#60A5FA', icon: '📖' },
              { label: t('university.certificates', 'Certificates'), value: certs.length,        color: '#FBBF24', icon: '🏆' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-3 bg-dark-800/60 border border-dark-700 text-center">
                <p className="text-lg">{s.icon}</p>
                <p className="font-black text-lg leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="text-gray-500 text-[10px] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Certificates */}
          {certs.length > 0 && (
            <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/5 p-4">
              <p className="text-yellow-400 text-sm font-bold flex items-center gap-2 mb-2">
                <Award size={14} /> {t('university.certs_earned', 'Certificates Earned')}
              </p>
              <div className="space-y-2">
                {certs.map(c => (
                  <div key={c.certificate_code} className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-semibold">{c.title}</p>
                      <p className="text-gray-500 text-xs">
                        {new Date(c.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                    <span className="text-gray-600 font-mono text-[10px]">{c.certificate_code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Course list */}
          <div className="space-y-3">
            <h2 className="text-white font-bold flex items-center gap-2 text-sm">
              <BookOpen size={14} className="text-neon-green" /> {t('university.all_courses', 'All Courses')}
            </h2>
            {courseLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!courseLoading && courses.map(course => (
              <CourseCard key={course.id} course={course} onClick={() => openCourse(course)} />
            ))}
            {courses.length === 0 && (
              <div className="rounded-2xl border border-dark-700 bg-dark-800/40 p-8 text-center">
                <GraduationCap size={28} className="mx-auto text-gray-600 mb-2" />
                <p className="text-gray-400 text-sm">{t('university.no_courses', 'No courses available yet.')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
